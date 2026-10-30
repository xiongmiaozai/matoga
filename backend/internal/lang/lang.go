// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package lang 构建「贴图名 ↔ 中文译名」映射，供前端搜索与显示使用。
//
// 数据来源与优先级（后者覆盖前者）：
//  1. 内置 server/assets/zh_cn.json（随仓库分发）
//  2. 各包根目录下的 <pack>/assets/minecraft/lang/zh_cn.json
//
// 映射在首次调用时懒加载并缓存，Invalidate 可强制重建。
package lang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// keyRE 匹配 Minecraft 语言文件里的方块/物品键。
//
//	block.minecraft.stone
//	item.minecraft.iron_ingot
//	tile.minecraft.stone.name   （旧版）
var keyRE = regexp.MustCompile(`^(block|item|tile)\.minecraft\.([a-z0-9_]+)(?:\.name)?$`)

// Maps 是构建结果。字段与 Node 侧保持同名，前端无需改动。
type Maps struct {
	ByTexName   map[string]string `json:"byTexName"`
	ByTexKey    map[string]string `json:"byTexKey"`
	ByZh        map[string]string `json:"byZh"`
	ByTexPinyin map[string]string `json:"byTexPinyin"`
	Count       int               `json:"count"`
}

// Service 持有缓存。并发安全。
type Service struct {
	// BuiltinPath 是内置汉化表路径，构造时确定。
	BuiltinPath string

	mu    sync.Mutex
	cache *Maps
}

// New 创建服务。builtinPath 指向 server/assets/zh_cn.json。
func New(builtinPath string) *Service {
	return &Service{BuiltinPath: builtinPath}
}

// Get 返回映射表。roots 的顺序决定覆盖优先级：靠后的覆盖靠前的。
func (s *Service) Get(roots []string) *Maps {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache != nil {
		return s.cache
	}

	files := make([]string, 0, 8)
	if s.BuiltinPath != "" {
		files = append(files, s.BuiltinPath)
	}
	for _, root := range roots {
		files = append(files, collectLangFiles(root)...)
	}

	merged := make(map[string]string, 8192)
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var m map[string]string
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		for k, v := range m {
			merged[k] = v
		}
	}

	s.cache = buildMaps(merged)
	return s.cache
}

// Invalidate 清空缓存，下次 Get 时重建。
func (s *Service) Invalidate() {
	s.mu.Lock()
	s.cache = nil
	s.mu.Unlock()
}

// Stats 返回缓存状态，供管理接口展示。
func (s *Service) Stats() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	loaded := s.cache != nil
	count := 0
	if loaded {
		count = s.cache.Count
	}
	return map[string]any{"loaded": loaded, "count": count}
}

// buildMaps 把合并后的语言表转成四张索引。
//
// 所有索引都遵循「先到先得」：同一个贴图名出现多次时保留首次写入的译名，
// 与 Node 侧行为一致（官方包先于用户包被读取）。
func buildMaps(zh map[string]string) *Maps {
	byTexName := make(map[string]string, len(zh))
	byTexKey := make(map[string]string, len(zh))
	byZh := make(map[string]string, len(zh))

	for k, v := range zh {
		if v == "" {
			continue
		}
		m := keyRE.FindStringSubmatch(k)
		if m == nil {
			continue
		}
		cat := m[1]
		if cat == "tile" {
			cat = "block" // 旧版 tile.* 视作 block
		}
		name := m[2]
		key := cat + "/" + name

		if _, ok := byTexKey[key]; !ok {
			byTexKey[key] = v
		}
		if _, ok := byTexName[name]; !ok {
			byTexName[name] = v
		}
		if _, ok := byZh[v]; !ok {
			byZh[v] = name
		}
	}

	return &Maps{
		ByTexName:   byTexName,
		ByTexKey:    byTexKey,
		ByZh:        byZh,
		ByTexPinyin: map[string]string{}, // 拼音由前端 pinyin-pro 处理，后端不再生成
		Count:       len(byTexName),
	}
}

// collectLangFiles 列出 root 下各包的 zh_cn.json。
//
// 返回值按目录名排序，保证结果稳定；不存在的目录静默跳过。
func collectLangFiles(root string) []string {
	if root == "" {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() || len(e.Name()) > 0 && e.Name()[0] == '.' {
			continue
		}
		out = append(out, filepath.Join(root, e.Name(), "assets", "minecraft", "lang", "zh_cn.json"))
	}
	return out
}
