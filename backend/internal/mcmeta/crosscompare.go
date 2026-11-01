// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"fmt"
	"path/filepath"
	"sort"
)

// maxCrossPacks 是一次交叉对比允许的包数上限。
const maxCrossPacks = 20

// CrossPack 是单个包的模型条目与数量。
type CrossPack struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// CrossPackPresence 描述某模型在某个包里的情况。
type CrossPackPresence struct {
	Size   int64 `json:"size"`
	Exists bool  `json:"exists"`
}

// CrossModel 是一个模型在多包间的对比记录。
type CrossModel struct {
	Path      string                       `json:"path"`
	Packs     map[string]CrossPackPresence `json:"packs"`
	PresentIn []string                     `json:"presentIn"`
	AbsentIn  []string                     `json:"absentIn"`
	MinSize   int64                        `json:"minSize"`
	MaxSize   int64                        `json:"maxSize"`
	SizeDiff  int64                        `json:"sizeDiff"`
}

// CrossCompareResult 是接口返回。
type CrossCompareResult struct {
	Packs  []CrossPack  `json:"packs"`
	Models []CrossModel `json:"models"`
	Total  int          `json:"total"`
}

// CrossCompareModels 对同一 root 下多个包按模型路径聚合。
//
// 输出每个模型在各包中的存在性与大小，并标注 presentIn / absentIn 与大小差异，
// 便于前端高亮「这个包有、那个包没有」的模型。
//
// names 为空或超过 maxCrossPacks 时返回错误（与 Node 侧一致）。
func CrossCompareModels(root string, names []string) (*CrossCompareResult, error) {
	if len(names) == 0 {
		return nil, fmt.Errorf("packs list is empty")
	}
	if len(names) > maxCrossPacks {
		return nil, fmt.Errorf("too many packs (max %d)", maxCrossPacks)
	}

	byPath := make(map[string]*CrossModel, 1024)
	packs := make([]CrossPack, 0, len(names))

	for _, name := range names {
		st, full, err := StatPack(root, name)
		if err != nil {
			// 单包读不到不该让整次对比失败：记 0 条继续
			packs = append(packs, CrossPack{Name: name, Count: 0})
			continue
		}

		var models []ModelEntry
		if st.IsDir() {
			pr := ResolveDirPack(full)
			if pr == "" {
				pr = full
			}
			models = WalkDirModels(pr)
		} else {
			files, err := ParseZipCentralDirectory(full)
			if err != nil {
				packs = append(packs, CrossPack{Name: name, Count: 0})
				continue
			}
			models = ZipModelEntries(files)
		}

		packs = append(packs, CrossPack{Name: name, Count: len(models)})
		for _, m := range models {
			rec, ok := byPath[m.Path]
			if !ok {
				rec = &CrossModel{Path: m.Path, Packs: make(map[string]CrossPackPresence, len(names))}
				byPath[m.Path] = rec
			}
			rec.Packs[name] = CrossPackPresence{Size: m.Size, Exists: true}
		}
	}

	// 补齐缺失包，并计算 presentIn / absentIn 与大小区间
	out := make([]CrossModel, 0, len(byPath))
	for _, rec := range byPath {
		rec.PresentIn = make([]string, 0, len(packs))
		rec.AbsentIn = make([]string, 0, len(packs))
		minSize := int64(-1)
		maxSize := int64(0)

		for _, p := range packs {
			pres, ok := rec.Packs[p.Name]
			if !ok {
				rec.Packs[p.Name] = CrossPackPresence{Size: 0, Exists: false}
				rec.AbsentIn = append(rec.AbsentIn, p.Name)
				continue
			}
			if !pres.Exists {
				rec.AbsentIn = append(rec.AbsentIn, p.Name)
				continue
			}
			rec.PresentIn = append(rec.PresentIn, p.Name)
			if minSize < 0 || pres.Size < minSize {
				minSize = pres.Size
			}
			if pres.Size > maxSize {
				maxSize = pres.Size
			}
		}

		if minSize < 0 {
			minSize = 0
		}
		rec.MinSize = minSize
		rec.MaxSize = maxSize
		rec.SizeDiff = maxSize - minSize
		out = append(out, *rec)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return &CrossCompareResult{Packs: packs, Models: out, Total: len(out)}, nil
}

// packFullPath 是测试与小工具用的路径拼接（保持与 StatPack 相同的 root 语义）。
func packFullPath(root, name string) string { return filepath.Join(root, name) }
