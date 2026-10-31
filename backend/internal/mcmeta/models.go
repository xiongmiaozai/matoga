// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"archive/zip"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// maxModelWalk 是单包模型遍历上限，避免超大包把内存打满。
const maxModelWalk = 20000

// ModelEntry 是一个模型文件条目。
type ModelEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// modelDirRE 匹配 assets/<ns>/(models|items)/ 下的路径。
//
// 用前缀判断而非正则：模型遍历是热点路径，逐条跑正则代价高。
func isModelDir(rel string) bool {
	if !strings.HasPrefix(rel, "assets/") {
		return false
	}
	// assets/<ns>/<kind>/...
	rest := rel[len("assets/"):]
	i := strings.IndexByte(rest, '/')
	if i <= 0 {
		return false
	}
	after := rest[i+1:]
	return strings.HasPrefix(after, "models/") || strings.HasPrefix(after, "items/")
}

// isModelExt 判断是否 .json（大小写不敏感）。
func isModelExt(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".json")
}

// WalkDirModels 递归列出包内全部模型 json。
//
// 只收 assets/<ns>/(models|items)/**.json —— blockstates 等其他 json 排除在外。
// 遍历在达到 maxModelWalk 时提前结束，返回已收集的部分结果。
func WalkDirModels(packRoot string) []ModelEntry {
	found := make([]ModelEntry, 0, 256)
	root := filepath.Clean(packRoot)

	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 权限/竞态问题跳过该条，不中断遍历
		}
		if len(found) >= maxModelWalk {
			return filepath.SkipAll
		}
		name := d.Name()
		if len(name) > 0 && name[0] == '.' {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !isModelDir(rel) || !isModelExt(name) {
			return nil
		}
		var size int64
		if info, err := d.Info(); err == nil {
			size = info.Size()
		}
		found = append(found, ModelEntry{Path: rel, Size: size})
		return nil
	})

	sort.Slice(found, func(i, j int) bool { return found[i].Path < found[j].Path })
	return found
}

// ZipModelEntries 从 zip 的条目列表里筛出模型 json。
//
// 兼容「包内多一层根目录」的布局：assets/... 之外还允许 <root>/assets/...。
func ZipModelEntries(files []*zip.File) []ModelEntry {
	out := make([]ModelEntry, 0, 128)
	for _, f := range files {
		if f.FileInfo().IsDir() || !isModelExt(f.Name) {
			continue
		}
		p := normalizeZipModelName(filepath.ToSlash(f.Name))
		if p == "" {
			continue
		}
		out = append(out, ModelEntry{Path: p, Size: int64(f.UncompressedSize64)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// normalizeZipModelName 已在 mcmeta.go 定义（含 ModelDirRe / zipModelRe 两条规则），
// 此处直接复用，不再重复实现。

// ParseZipCentralDirectory 读取 zip 的完整条目表。
//
// 用 zip.OpenReader 而不是逐条解压：只读中央目录，不加载文件内容，
// 因此对大包也很快。
func ParseZipCentralDirectory(path string) ([]*zip.File, error) {
	rc, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return rc.File, nil
}

// StatPack 返回包路径的文件信息。
//
// 目录包与 zip 包统一处理；不存在时返回错误。
func StatPack(root, name string) (os.FileInfo, string, error) {
	if !ValidPackName(name) {
		return nil, "", &PackNameError{Name: name}
	}
	full := filepath.Join(root, name)
	st, err := os.Stat(full)
	if err != nil {
		return nil, "", err
	}
	return st, full, nil
}

// PackNameError 表示包名不合法（含路径分隔符、.. 等）。
type PackNameError struct{ Name string }

func (e *PackNameError) Error() string { return "invalid pack name: " + e.Name }
