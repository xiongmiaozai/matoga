// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package mcmeta 提供 Minecraft 材质包（资源包）的扫描与分组能力。
//
// 与 Node 版 server/services/mcmeta-service.js 对齐，但 zip 解析改用标准库
// archive/zip，不再手写中央目录解析。
package mcmeta

import (
	"archive/zip"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// 包名与路径常量。
const (
	McmetaName   = "pack.mcmeta"
	AssetsPrefix = "assets/"

	// MaxTexWalk / MaxModelWalk 是递归收集上限，防止超大包卡死。
	MaxTexWalk   = 20000
	MaxModelWalk = 20000
)

var (
	// ImgExtRe 匹配图片扩展名（排除 .png.mcmeta / .json 等非贴图）。
	ImgExtRe = regexp.MustCompile(`(?i)\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$`)
	// TexDirRe 限定贴图位于 assets/<ns>/textures/ 下。
	TexDirRe = regexp.MustCompile(`^assets/[^/]+/textures/`)
	// ModelDirRe 限定模型位于 assets/<ns>/models/ 或 assets/<ns>/items/ 下。
	ModelDirRe = regexp.MustCompile(`^assets/[^/]+/(models|items)/`)
	// ModelExtRe 匹配模型 JSON。
	ModelExtRe = regexp.MustCompile(`(?i)\.json$`)

	// zipTexRe / zipModelRe 容忍包内容套一层根文件夹（<root>/assets/...）。
	zipTexRe   = regexp.MustCompile(`^[^/]+/(assets/[^/]+/textures/.+)$`)
	zipModelRe = regexp.MustCompile(`^[^/]+/(assets/[^/]+/(models|items)/.+)$`)

	texPathRe   = regexp.MustCompile(`^assets/([^/]+)/textures/(.+)$`)
	modelPathRe = regexp.MustCompile(`^assets/([^/]+)/models/(.+)$`)
	itemPathRe  = regexp.MustCompile(`^assets/([^/]+)/items/([^/]+\.json)$`)
)

// ZipExts 是可识别的压缩包扩展名。
var ZipExts = map[string]bool{"zip": true, "mcpack": true, "resourcepack": true}

// TexFile 是包内一个贴图条目。
type TexFile struct {
	Path  string  `json:"path"`
	Name  string  `json:"name"`
	Size  int64   `json:"size"`
	Mtime float64 `json:"mtime"`
}

// Group 是贴图/模型的分组。
type Group struct {
	Key   string    `json:"key"`
	Count int       `json:"count"`
	Files []TexFile `json:"files"`
}

// PackGroups 是 listPackTexGroups / listPackModelGroups 的返回。
type PackGroups struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	Root   *string `json:"root"`
	Total  int     `json:"total"`
	Groups []Group `json:"groups"`
}

// ValidPackName 校验包名，与 Node 版 validPackName 一致。
func ValidPackName(name string) bool {
	if name == "" || len(name) > 255 || name != strings.TrimSpace(name) {
		return false
	}
	if name == "." || name == ".." {
		return false
	}
	if strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return false
	}
	return filepath.Base(name) == name
}

// parseTexPath 解析 assets/<ns>/textures/<rest>。
func parseTexPath(p string) (ns, rest string, ok bool) {
	m := texPathRe.FindStringSubmatch(p)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// parseModelPath 解析模型路径；items/** 返回 kind="item"。
func parseModelPath(p string) (ns, rest, kind string, ok bool) {
	if m := modelPathRe.FindStringSubmatch(p); m != nil {
		return m[1], m[2], "", true
	}
	if m := itemPathRe.FindStringSubmatch(p); m != nil {
		return m[1], m[2], "item", true
	}
	return "", "", "", false
}

// normalizeZipTexName 把 zip 条目名归一化为 assets/... 形式。
func normalizeZipTexName(name string) string {
	if TexDirRe.MatchString(name) {
		return name
	}
	if m := zipTexRe.FindStringSubmatch(name); m != nil {
		return m[1]
	}
	return ""
}

// normalizeZipModelName 把 zip 条目名归一化为模型路径。
func normalizeZipModelName(name string) string {
	if ModelDirRe.MatchString(name) {
		return name
	}
	if m := zipModelRe.FindStringSubmatch(name); m != nil {
		return m[1]
	}
	return ""
}

// readZipEntries 用标准库读取 zip 中央目录，返回 (归一化名, 原始名, 未压缩大小)。
// 替代 Node 版手写的 parseZipCentralDirectory。
func readZipEntries(full string) ([]*zip.File, error) {
	zr, err := zip.OpenReader(full)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return zr.File, nil
}

// zipTextureEntries 从 zip 条目中筛出贴图。
func zipTextureEntries(files []*zip.File) []TexFile {
	out := make([]TexFile, 0, 64)
	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}
		p := normalizeZipTexName(f.Name)
		if p == "" || !ImgExtRe.MatchString(f.Name) {
			continue
		}
		out = append(out, TexFile{Path: p, Size: int64(f.UncompressedSize64)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// zipModelEntries 从 zip 条目中筛出模型。
func zipModelEntries(files []*zip.File) []TexFile {
	out := make([]TexFile, 0, 64)
	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}
		p := normalizeZipModelName(f.Name)
		if p == "" || !ModelExtRe.MatchString(f.Name) {
			continue
		}
		out = append(out, TexFile{Path: p, Size: int64(f.UncompressedSize64)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// ResolveDirPack 解析目录包根（容忍外面套一层文件夹）。
// 返回包根路径；无法识别时返回空串。
func ResolveDirPack(dir string) string {
	hasMcmeta := func(base string) bool {
		st, err := os.Stat(filepath.Join(base, McmetaName))
		return err == nil && !st.IsDir()
	}
	if hasMcmeta(dir) {
		return dir
	}
	ents, err := os.ReadDir(dir)
	if err == nil {
		subs := make([]string, 0, len(ents))
		for _, e := range ents {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				subs = append(subs, e.Name())
			}
		}
		if len(subs) == 1 {
			sub := filepath.Join(dir, subs[0])
			if hasMcmeta(sub) {
				return sub
			}
			if st, err := os.Stat(filepath.Join(sub, "assets")); err == nil && st.IsDir() {
				return sub
			}
		}
	}
	if st, err := os.Stat(filepath.Join(dir, "assets")); err == nil && st.IsDir() {
		return dir
	}
	return ""
}

// walkDirFiles 递归收集满足 match 的文件，返回相对包根的斜杠路径。
func walkDirFiles(packRoot string, limit int, match func(rel string) bool) []TexFile {
	found := make([]TexFile, 0, 256)
	var walk func(abs, rel string)
	walk = func(abs, rel string) {
		if len(found) >= limit {
			return
		}
		ents, err := os.ReadDir(abs)
		if err != nil {
			return
		}
		for _, e := range ents {
			if len(found) >= limit {
				return
			}
			if strings.HasPrefix(e.Name(), ".") {
				continue
			}
			r := e.Name()
			if rel != "" {
				r = rel + "/" + e.Name()
			}
			if e.IsDir() {
				walk(filepath.Join(abs, e.Name()), r)
			} else if match(r) {
				found = append(found, TexFile{Path: r})
			}
		}
	}
	walk(packRoot, "")
	return found
}

// walkDirTextures 递归收集目录包内贴图。
func walkDirTextures(packRoot string) []TexFile {
	return walkDirFiles(packRoot, MaxTexWalk, func(rel string) bool {
		return TexDirRe.MatchString(rel) && ImgExtRe.MatchString(rel)
	})
}

// walkDirModels 递归收集目录包内模型。
func walkDirModels(packRoot string) []TexFile {
	return walkDirFiles(packRoot, MaxModelWalk, func(rel string) bool {
		return ModelDirRe.MatchString(rel) && ModelExtRe.MatchString(rel)
	})
}

// statTexMeta 为目录包内的文件补齐 size/mtime。
func statTexMeta(packRoot string, files []TexFile) {
	for i := range files {
		st, err := os.Stat(filepath.Join(packRoot, filepath.FromSlash(files[i].Path)))
		if err != nil {
			continue
		}
		files[i].Size = st.Size()
		files[i].Mtime = float64(st.ModTime().UnixMilli())
	}
}

// sortGroups 排序：根级分组（key 为空）置首，其余按数量降序，再按 key 升序。
func sortGroups(groups map[string]*Group) []Group {
	out := make([]Group, 0, len(groups))
	for _, g := range groups {
		out = append(out, *g)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if (a.Key == "") != (b.Key == "") {
			return a.Key == ""
		}
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return a.Key < b.Key
	})
	return out
}

// ListPackTexGroups 列出单个包的贴图分组。
func ListPackTexGroups(root, name string) (*PackGroups, error) {
	if !ValidPackName(name) {
		return nil, fmt.Errorf("invalid pack name")
	}
	full := filepath.Join(root, name)
	st, err := os.Stat(full)
	if err != nil {
		return nil, fmt.Errorf("pack not found: %s", name)
	}

	kind := "dir"
	var packRoot string
	var texs []TexFile
	if st.IsDir() {
		packRoot = ResolveDirPack(full)
		if packRoot == "" {
			packRoot = full
		}
		texs = walkDirTextures(packRoot)
		statTexMeta(packRoot, texs)
	} else {
		kind = "zip"
		files, err := readZipEntries(full)
		if err != nil {
			return nil, err
		}
		texs = zipTextureEntries(files)
	}

	groups := make(map[string]*Group, 16)
	for _, t := range texs {
		_, rest, ok := parseTexPath(t.Path)
		if !ok {
			continue
		}
		seg := strings.Split(rest, "/")
		key := ""
		if len(seg) >= 2 {
			key = seg[0]
		}
		g := groups[key]
		if g == nil {
			g = &Group{Key: key, Files: make([]TexFile, 0, 8)}
			groups[key] = g
		}
		g.Count++
		g.Files = append(g.Files, TexFile{
			Path:  t.Path,
			Name:  seg[len(seg)-1],
			Size:  t.Size,
			Mtime: t.Mtime,
		})
	}

	res := &PackGroups{Name: name, Kind: kind, Total: len(texs), Groups: sortGroups(groups)}
	if packRoot != "" {
		r := packRoot
		res.Root = &r
	}
	return res, nil
}

// ListPackModelGroups 列出单个包的模型分组。
func ListPackModelGroups(root, name string) (*PackGroups, error) {
	if !ValidPackName(name) {
		return nil, fmt.Errorf("invalid pack name")
	}
	full := filepath.Join(root, name)
	st, err := os.Stat(full)
	if err != nil {
		return nil, fmt.Errorf("pack not found: %s", name)
	}

	kind := "dir"
	var packRoot string
	var models []TexFile
	if st.IsDir() {
		packRoot = ResolveDirPack(full)
		if packRoot == "" {
			packRoot = full
		}
		models = walkDirModels(packRoot)
		statTexMeta(packRoot, models)
	} else {
		kind = "zip"
		files, err := readZipEntries(full)
		if err != nil {
			return nil, err
		}
		models = zipModelEntries(files)
	}

	groups := make(map[string]*Group, 16)
	for _, t := range models {
		_, rest, mkind, ok := parseModelPath(t.Path)
		if !ok {
			continue
		}
		// 1.21.4+ 物品模型定义归入独立分组；models/ 按第一级目录分组。
		key := ""
		if mkind == "item" {
			key = "items"
		} else if seg := strings.Split(rest, "/"); len(seg) >= 2 {
			key = seg[0]
		}
		g := groups[key]
		if g == nil {
			g = &Group{Key: key, Files: make([]TexFile, 0, 8)}
			groups[key] = g
		}
		g.Count++
		g.Files = append(g.Files, TexFile{
			Path:  t.Path,
			Name:  path.Base(t.Path),
			Size:  t.Size,
			Mtime: t.Mtime,
		})
	}

	res := &PackGroups{Name: name, Kind: kind, Total: len(models), Groups: sortGroups(groups)}
	if packRoot != "" {
		r := packRoot
		res.Root = &r
	}
	return res, nil
}

// ListPacks 遍历 root 下所有包（目录或 zip），用 lister 逐个收集。
// 单个包失败会被跳过，与 Node 版 collectPacks 一致。
func ListPacks(root string, lister func(root, name string) (*PackGroups, error)) []PackGroups {
	if root == "" {
		return []PackGroups{}
	}
	ents, err := os.ReadDir(root)
	if err != nil {
		return []PackGroups{}
	}
	out := make([]PackGroups, 0, len(ents))
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(root, e.Name())
		st, err := os.Stat(full)
		if err != nil {
			continue
		}
		if !st.IsDir() {
			ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(e.Name())), ".")
			if !ZipExts[ext] {
				continue
			}
		}
		g, err := lister(root, e.Name())
		if err != nil {
			continue
		}
		out = append(out, *g)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
