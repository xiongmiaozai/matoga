// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// zipExts 是识别 zip 包的扩展名集合。
var zipExts = map[string]struct{}{"zip": {}, "jar": {}, "mcpack": {}}

// ListAllTexPaths 扁平收集 root 下全部包的贴图相对路径（去重后排序）。
//
// 供前端校验「模型引用的贴图是否由原版提供」：只要路径出现在这个集合里，
// 就说明该贴图在原版资源中存在。
//
// 目录包走递归遍历，zip 包读中央目录；非包文件跳过。
// root 不存在时返回空列表而不是错误 —— 用户没配置官方包是正常状态。
func ListAllTexPaths(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}

	seen := make(map[string]struct{}, 8192)
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(root, name)
		st, err := os.Stat(full)
		if err != nil {
			continue
		}

		var texs []TexFile
		if st.IsDir() {
			packRoot := ResolveDirPack(full)
			if packRoot == "" {
				packRoot = full
			}
			texs = walkDirTextures(packRoot)
		} else if isZipName(name) {
			files, err := ParseZipCentralDirectory(full)
			if err != nil {
				continue
			}
			texs = zipTextureEntries(files)
		} else {
			continue
		}

		for _, t := range texs {
			seen[t.Path] = struct{}{}
		}
	}

	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}

// isZipName 判断文件名扩展名是否属于 zip 家族。
func isZipName(name string) bool {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	_, ok := zipExts[ext]
	return ok
}
