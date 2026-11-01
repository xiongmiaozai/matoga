// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package packbuilder 按 Minecraft 资源包规范生成材质包。
//
// 输出可为目录或 .zip：
//   - pack.mcmeta：支持 pack_format（1.21.8 及以前）与 min_format/max_format（1.21.9+）两种写法
//   - pack.png：调用方可传入 base64，缺失时生成 128×128 占位图
//   - 资产文件：按扩展名自动归类到 assets/<ns>/textures|models/，或由调用方指定包内路径
//
// zip 打包直接用标准库 archive/zip（Deflate），不再手写中央目录。
package packbuilder

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 默认值与上限。
const (
	DefaultNamespace  = "minecraft"
	DefaultPackFormat = 64 // 1.21.7 – 1.21.8
	DefaultName       = "我的材质包"
	MaxFiles          = 2000
	maxFileBytes      = 256 << 20 // 256 MiB
)

// imageExts / modelExts 决定磁盘文件归到哪个目录。
var (
	imageExts = map[string]struct{}{
		"png": {}, "jpg": {}, "jpeg": {}, "webp": {}, "gif": {},
		"bmp": {}, "tiff": {}, "tif": {}, "avif": {}, "tga": {},
	}
	modelExts = map[string]struct{}{"json": {}, "bbmodel": {}}
)

// FileInput 是 files 数组的一项，可为字符串路径或对象。
type FileInput struct {
	// Src 是磁盘路径（字符串形式时也走这里）。
	Src string `json:"src"`
	// Name 是显示名，仅用于内联数据时的归类与错误信息。
	Name string `json:"name"`
	// Data 是 base64 内联数据（不含 data: 前缀）。
	Data string `json:"data"`
	// Dest 是显式指定的包内相对路径。
	Dest string `json:"dest"`
}

// ItemInput 是资产库条目（craft item），转成包内文件。
type ItemInput struct {
	// RelPath 是资产库记录的包内相对路径。
	RelPath string `json:"relPath"`
	// Src 是磁盘绝对路径。
	Src string `json:"src"`
	// Dest 是显式目标路径。
	Dest string `json:"dest"`
}

// Request 是 /api/pack-builder/build 的请求体。
type Request struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	PackFormat  float64     `json:"packFormat"`
	MinFormat   float64     `json:"minFormat"`
	MaxFormat   float64     `json:"maxFormat"`
	Namespace   string      `json:"namespace"`
	Files       []FileInput `json:"files"`
	Items       []ItemInput `json:"items"`
	PackPng     string      `json:"packPng"`
	PackPngData string      `json:"packPngData"`
	Output      string      `json:"output"`
	DestRoot    string      `json:"destRoot"`
}

// Result 是生成结果。
type Result struct {
	Name        string `json:"name"`
	File        string `json:"file,omitempty"`
	Dir         string `json:"dir,omitempty"`
	Output      string `json:"output"`
	PackFormat  *int   `json:"packFormat"`
	MinFormat   *int   `json:"minFormat"`
	MaxFormat   *int   `json:"maxFormat"`
	Written     int    `json:"written"`
	Skipped     int    `json:"skipped"`
	SkippedList []Skip `json:"skippedList"`
}

// Skip 记录被跳过的条目与原因。
type Skip struct {
	Name   string `json:"name,omitempty"`
	Src    string `json:"src,omitempty"`
	Reason string `json:"reason"`
}

// entry 是待写入包内的一个文件。
type entry struct {
	dest  string
	bytes []byte
}

// extOf 取小写扩展名（不含点）。
func extOf(name string) string {
	i := strings.LastIndex(name, ".")
	if i < 0 || i == len(name)-1 {
		return ""
	}
	return strings.ToLower(name[i+1:])
}

// safeRel 校验调用方指定的包内路径。
//
// 拒绝 .. / 反斜杠 / NUL / 绝对路径，避免写出包目录。
func safeRel(rel string) string {
	if rel == "" || strings.Contains(rel, "..") || strings.Contains(rel, `\`) ||
		strings.ContainsRune(rel, 0) || strings.HasPrefix(rel, "/") {
		return ""
	}
	return rel
}

// classifyByName 按扩展名把一个文件名归到 textures/ 或 models/。
func classifyByName(name, namespace string) string {
	base := filepath.Base(name)
	ext := extOf(base)
	if _, ok := imageExts[ext]; ok {
		return "assets/" + namespace + "/textures/" + base
	}
	if _, ok := modelExts[ext]; ok {
		return "assets/" + namespace + "/models/" + base
	}
	return ""
}

// resolveFiles 把请求里的 files 解析成待写入条目。
//
// 支持三种形态：内联 base64、磁盘路径、显式 dest。
// 任意一项失败只跳过该项，不中断整体。
func resolveFiles(files []FileInput, namespace string) ([]entry, []Skip) {
	out := make([]entry, 0, len(files))
	skipped := make([]Skip, 0)

	for _, f := range files {
		destHint := safeRel(f.Dest)

		// 形态一：内联 base64
		if f.Data != "" {
			buf, err := base64.StdEncoding.DecodeString(f.Data)
			if err != nil {
				skipped = append(skipped, Skip{Name: f.Name, Reason: "bad base64 data"})
				continue
			}
			if len(buf) == 0 || len(buf) > maxFileBytes {
				skipped = append(skipped, Skip{Name: f.Name, Reason: "empty or too large"})
				continue
			}
			dest := destHint
			if dest == "" {
				dest = classifyByName(f.Name, namespace)
			}
			if dest == "" {
				skipped = append(skipped, Skip{Name: f.Name, Reason: "unsupported file type"})
				continue
			}
			out = append(out, entry{dest: dest, bytes: buf})
			continue
		}

		// 形态二：磁盘路径
		src := f.Src
		if src == "" {
			skipped = append(skipped, Skip{Name: f.Name, Reason: "invalid source path"})
			continue
		}
		info, err := os.Stat(src)
		if err != nil || info.IsDir() {
			skipped = append(skipped, Skip{Src: src, Reason: "file missing"})
			continue
		}
		if info.Size() > maxFileBytes {
			skipped = append(skipped, Skip{Src: src, Reason: "file too large"})
			continue
		}
		buf, err := os.ReadFile(src)
		if err != nil {
			skipped = append(skipped, Skip{Src: src, Reason: "read failed"})
			continue
		}
		dest := destHint
		if dest == "" {
			dest = classifyByName(src, namespace)
		}
		if dest == "" {
			skipped = append(skipped, Skip{Src: src, Reason: "unsupported file type"})
			continue
		}
		out = append(out, entry{dest: dest, bytes: buf})
	}
	return out, skipped
}

// resolveItems 把资产库条目解析成待写入条目。
func resolveItems(items []ItemInput, namespace string) ([]entry, []Skip) {
	out := make([]entry, 0, len(items))
	skipped := make([]Skip, 0)

	for _, it := range items {
		dest := safeRel(it.Dest)
		if dest == "" {
			dest = safeRel(it.RelPath)
		}
		if dest == "" {
			dest = classifyByName(it.Src, namespace)
		}
		if dest == "" {
			skipped = append(skipped, Skip{Src: it.Src, Reason: "cannot determine dest"})
			continue
		}
		if it.Src == "" {
			skipped = append(skipped, Skip{Name: dest, Reason: "missing src"})
			continue
		}
		info, err := os.Stat(it.Src)
		if err != nil || info.IsDir() || info.Size() > maxFileBytes {
			skipped = append(skipped, Skip{Src: it.Src, Reason: "file missing or too large"})
			continue
		}
		buf, err := os.ReadFile(it.Src)
		if err != nil {
			skipped = append(skipped, Skip{Src: it.Src, Reason: "read failed"})
			continue
		}
		out = append(out, entry{dest: dest, bytes: buf})
	}
	return out, skipped
}

// dedupe 处理包内路径冲突：重名的按 -2 / -3 递增重命名。
//
// 直接覆盖会让用户丢文件，改名比报错更友好。
func dedupe(entries []entry) []entry {
	used := make(map[string]struct{}, len(entries))
	out := make([]entry, 0, len(entries))

	for _, e := range entries {
		dest := e.dest
		if _, clash := used[dest]; clash {
			ext := filepath.Ext(dest)
			stem := strings.TrimSuffix(dest, ext)
			for i := 2; ; i++ {
				cand := fmt.Sprintf("%s-%d%s", stem, i, ext)
				if _, c := used[cand]; !c {
					dest = cand
					break
				}
			}
		}
		used[dest] = struct{}{}
		out = append(out, entry{dest: dest, bytes: e.bytes})
	}
	return out
}

// buildMcmeta 生成 pack.mcmeta 内容。
//
// 有 min/max 区间时用新写法（1.21.9+），否则用 pack_format。
func buildMcmeta(name, description string, packFormat, minFormat, maxFormat float64) ([]byte, *int, *int, *int) {
	desc := strings.TrimSpace(description)
	if desc == "" {
		desc = name + " · matoga"
	}
	pack := map[string]any{"description": desc}

	var pf, minF, maxF *int
	if minFormat > 0 && maxFormat > 0 {
		mn, mx := int(minFormat), int(maxFormat)
		pack["min_format"] = mn
		pack["max_format"] = mx
		minF, maxF = &mn, &mx
	} else {
		v := DefaultPackFormat
		if packFormat > 0 {
			v = int(packFormat)
		}
		pack["pack_format"] = v
		pf = &v
	}

	buf, _ := json.MarshalIndent(map[string]any{"pack": pack}, "", "  ")
	return buf, pf, minF, maxF
}

// placeholderPackPng 返回内置的 1×1 透明 PNG。
//
// 真正的 128×128 草方块图标由前端生成（前端已有 canvas），
// 后端只保证 pack.png 一定存在，避免资源包缺图标告警。
func placeholderPackPng() []byte {
	// 1×1 透明 PNG 的固定字节
	const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
	buf, _ := base64.StdEncoding.DecodeString(b64)
	return buf
}

// uniqueName 在 root 下找一个不冲突的名字。
func uniqueName(root, name, ext string) string {
	cand := name + ext
	if _, err := os.Stat(filepath.Join(root, cand)); os.IsNotExist(err) {
		return cand
	}
	for i := 2; ; i++ {
		cand = fmt.Sprintf("%s-%d%s", name, i, ext)
		if _, err := os.Stat(filepath.Join(root, cand)); os.IsNotExist(err) {
			return cand
		}
	}
}

// writeZip 用标准库写成 zip。
func writeZip(fullPath string, mcmeta, packPng []byte, entries []entry) error {
	f, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	write := func(name string, data []byte) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := write("pack.mcmeta", mcmeta); err != nil {
		return err
	}
	if err := write("pack.png", packPng); err != nil {
		return err
	}
	for _, e := range entries {
		if err := write(e.dest, e.bytes); err != nil {
			return err
		}
	}
	return zw.Close()
}

// Build 生成资源包。
func Build(req Request) (*Result, error) {
	root := req.DestRoot
	if root == "" {
		return nil, fmt.Errorf("destRoot not configured")
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = DefaultName
	}
	namespace := strings.TrimSpace(req.Namespace)
	if namespace == "" {
		namespace = DefaultNamespace
	}
	if !isValidNamespace(namespace) {
		return nil, fmt.Errorf("invalid namespace (lowercase a-z 0-9 _ -)")
	}
	output := "dir"
	if req.Output == "zip" {
		output = "zip"
	}

	fileEntries, skipFiles := resolveFiles(req.Files, namespace)
	itemEntries, skipItems := resolveItems(req.Items, namespace)
	all := append(fileEntries, itemEntries...)
	if len(all) > MaxFiles {
		return nil, fmt.Errorf("too many files: %d > %d", len(all), MaxFiles)
	}

	skipped := append(skipFiles, skipItems...)
	entries := dedupe(all)

	mcmetaBytes, pf, minF, maxF := buildMcmeta(name, req.Description, req.PackFormat, req.MinFormat, req.MaxFormat)

	// pack.png 优先级：PackPngData（base64） > PackPng（磁盘路径） > 内置占位
	var packPng []byte
	if req.PackPngData != "" {
		if b, err := base64.StdEncoding.DecodeString(req.PackPngData); err == nil {
			packPng = b
		}
	}
	if packPng == nil && req.PackPng != "" {
		if b, err := os.ReadFile(req.PackPng); err == nil {
			packPng = b
		}
	}
	if packPng == nil {
		packPng = placeholderPackPng()
	}

	res := &Result{
		Output:      output,
		PackFormat:  pf,
		MinFormat:   minF,
		MaxFormat:   maxF,
		Written:     len(entries),
		Skipped:     len(skipped),
		SkippedList: skipped,
	}

	if output == "zip" {
		fileName := uniqueName(root, name, ".zip")
		fullPath := filepath.Join(root, fileName)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			return nil, err
		}
		if err := writeZip(fullPath, mcmetaBytes, packPng, entries); err != nil {
			return nil, err
		}
		res.Name = fileName
		res.File = fullPath
		return res, nil
	}

	dirName := uniqueName(root, name, "")
	packDir := filepath.Join(root, dirName)
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(packDir, "pack.mcmeta"), mcmetaBytes, 0o644); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(packDir, "pack.png"), packPng, 0o644); err != nil {
		return nil, err
	}
	for _, e := range entries {
		full := filepath.Join(packDir, filepath.FromSlash(e.dest))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(full, e.bytes, 0o644); err != nil {
			return nil, err
		}
	}
	res.Name = dirName
	res.Dir = packDir
	return res, nil
}

// isValidNamespace 校验命名空间：小写字母、数字、下划线、短横线。
func isValidNamespace(ns string) bool {
	if ns == "" {
		return false
	}
	for _, r := range ns {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}
