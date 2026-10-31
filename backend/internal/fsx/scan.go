// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package fsx

import (
	"io/fs"
	"os"
	"path/filepath"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// Entry 是一次目录扫描的结果项，字段名与前端契约一致。
type Entry struct {
	Name        string  `json:"name"`
	BaseName    string  `json:"baseName"`
	FullPath    string  `json:"fullPath"`
	IsDirectory bool    `json:"isDirectory"`
	Size        int64   `json:"size"`
	Mtime       float64 `json:"mtime"`
	Error       bool    `json:"error,omitempty"`
}

// Scan 扫描目录，返回条目列表。
//
// 非递归模式下 name 就是文件名；递归模式下 name 是相对路径（用 `/` 分隔）。
func Scan(folderPath string, ignorePatterns []string, recursive bool) ([]Entry, error) {
	entries := make([]Entry, 0, 64)
	if !recursive {
		names, err := os.ReadDir(folderPath)
		if err != nil {
			return nil, httpx.Errorf(httpx.CodeFSNotFound, err.Error())
		}
		for _, de := range names {
			if ShouldIgnore(de.Name(), ignorePatterns) {
				continue
			}
			full := filepath.Join(folderPath, de.Name())
			entries = append(entries, toEntry(full, de.Name(), full))
		}
		return entries, nil
	}
	walk(folderPath, "", ignorePatterns, &entries)
	return entries, nil
}

func walk(dir, relBase string, ignorePatterns []string, out *[]Entry) {
	des, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, de := range des {
		if ShouldIgnore(de.Name(), ignorePatterns) {
			continue
		}
		full := filepath.Join(dir, de.Name())
		rel := de.Name()
		if relBase != "" {
			rel = relBase + "/" + de.Name()
		}
		*out = append(*out, toEntry(full, rel, full))
		if de.IsDir() {
			walk(full, rel, ignorePatterns, out)
		}
	}
}

func toEntry(full, relName, statPath string) Entry {
	base := filepath.Base(full)
	info, err := os.Stat(statPath)
	if err != nil {
		return Entry{Name: relName, BaseName: base, FullPath: full, Error: true}
	}
	e := Entry{
		Name:        relName,
		BaseName:    base,
		FullPath:    full,
		IsDirectory: info.IsDir(),
	}
	if !info.IsDir() {
		e.Size = info.Size()
	}
	e.Mtime = float64(info.ModTime().UnixMilli())
	return e
}

// DirEntry 是目录浏览的一级结果。
type DirEntry struct {
	Name     string `json:"name"`
	FullPath string `json:"fullPath"`
}

// skipDirs 是目录浏览时固定跳过的名字。
var skipDirs = []string{".git", "node_modules", "System Volume Information", "$RECYCLE.BIN"}

// BrowseRoots 返回盘符/主目录列表，用于路径选择器的初始节点。
func BrowseRoots() ([]DirEntry, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	roots := make([]DirEntry, 0, 8)
	if home != "" {
		roots = append(roots, DirEntry{Name: home, FullPath: home})
	}
	if isWindows() {
		for c := 'A'; c <= 'Z'; c++ {
			d := string(c) + `:\`
			if _, err := os.ReadDir(d); err == nil {
				roots = append(roots, DirEntry{Name: d, FullPath: d})
			}
		}
		return roots, nil
	}
	roots = append(roots, DirEntry{Name: "/", FullPath: "/"})
	return roots, nil
}

// Browse 列出目录下的子目录。
func Browse(p string) (path string, parent *string, dirs []DirEntry, err error) {
	if p == "" {
		roots, e := BrowseRoots()
		if e != nil {
			return "", nil, nil, e
		}
		return "", nil, roots, nil
	}
	des, e := os.ReadDir(p)
	if e != nil {
		return "", nil, nil, httpx.Errorf(httpx.CodeFSNotFound, e.Error())
	}
	dirs = make([]DirEntry, 0, len(des))
	for _, de := range des {
		if !de.IsDir() || ShouldIgnore(de.Name(), skipDirs) {
			continue
		}
		dirs = append(dirs, DirEntry{Name: de.Name(), FullPath: filepath.Join(p, de.Name())})
	}
	sortDirsByName(dirs)
	dir := filepath.Dir(p)
	if dir == p {
		return p, nil, dirs, nil
	}
	return p, &dir, dirs, nil
}

func sortDirsByName(dirs []DirEntry) {
	// 目录数量通常不大，插入排序足够且无需额外依赖。
	for i := 1; i < len(dirs); i++ {
		for j := i; j > 0 && dirs[j].Name < dirs[j-1].Name; j-- {
			dirs[j], dirs[j-1] = dirs[j-1], dirs[j]
		}
	}
}

// Search 在目录下按深度限制搜索名字包含 q 的子目录。
func Search(root, q string, maxDepth, limit int) []DirEntry {
	results := make([]DirEntry, 0, limit)
	if q == "" {
		return results
	}
	var walkSearch func(dir string, depth int)
	walkSearch = func(dir string, depth int) {
		if depth > maxDepth || len(results) >= limit {
			return
		}
		des, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, de := range des {
			if !de.IsDir() {
				continue
			}
			full := filepath.Join(dir, de.Name())
			if containsFold(de.Name(), q) {
				results = append(results, DirEntry{Name: de.Name(), FullPath: full})
				if len(results) >= limit {
					return
				}
			}
			walkSearch(full, depth+1)
		}
	}
	walkSearch(root, 0)
	return results
}

func containsFold(s, sub string) bool {
	return len(sub) <= len(s) && indexFold(s, sub) >= 0
}

func indexFold(s, sub string) int {
	n, m := len(s), len(sub)
	if m == 0 {
		return 0
	}
	for i := 0; i+m <= n; i++ {
		match := true
		for j := 0; j < m; j++ {
			if lowerByte(s[i+j]) != lowerByte(sub[j]) {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func lowerByte(b byte) byte {
	if b >= 'A' && b <= 'Z' {
		return b + 32
	}
	return b
}

// 编译期断言：确保 os.DirEntry 被使用（避免导入未用）。
var _ fs.DirEntry
