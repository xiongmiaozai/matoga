// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"os"
	"path/filepath"
	"strings"
)

// CacheStats 是缓存统计的统一形状，供 /api/cache/stats 直接序列化。
type CacheStats struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Files  int    `json:"files,omitempty"`
	Bytes  int64  `json:"bytes,omitempty"`
	Loaded bool   `json:"loaded,omitempty"`
	Count  int    `json:"count,omitempty"`
}

// dirStats 统计目录下的文件数与总字节数。
//
// 目录不存在时返回零值，不报错 —— 空缓存是正常状态。
func dirStats(dir string) (files int, bytes int64) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if e.IsDir() {
			// 一层子目录（如 model-thumbs 按 hash 分桶）递归统计
			sub := filepath.Join(dir, e.Name())
			subEntries, err := os.ReadDir(sub)
			if err != nil {
				continue
			}
			for _, se := range subEntries {
				if se.IsDir() {
					continue
				}
				info, err := se.Info()
				if err != nil {
					continue
				}
				files++
				bytes += info.Size()
			}
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files++
		bytes += info.Size()
	}
	return files, bytes
}

// clearDir 删除目录下的全部内容，保留目录本身。
//
// 用「列出 + 逐个删除」而不是整体 RemoveAll 再重建，避免并发请求在窗口期读不到目录。
func clearDir(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	removed := 0
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		if err := os.RemoveAll(p); err != nil {
			continue
		}
		removed++
	}
	return removed, nil
}

// Stats 返回贴图缩略图缓存规模。
func (t *Thumb) Stats() CacheStats {
	files, bytes := dirStats(t.dir)
	return CacheStats{Kind: "disk", Label: "贴图缩略图", Files: files, Bytes: bytes}
}

// ClearAll 清空贴图缩略图缓存，返回删除的条目数。
func (t *Thumb) ClearAll() (int, error) {
	return clearDir(t.dir)
}

// Stats 返回模型缩略图缓存规模。
//
// 模型缩略图按 key hash 分桶存放，可能有多帧，因此递归统计一层子目录。
func (m *ModelThumb) Stats() CacheStats {
	files, bytes := dirStats(m.base)
	return CacheStats{Kind: "disk", Label: "模型缩略图", Files: files, Bytes: bytes}
}

// ClearAll 清空模型缩略图缓存。
func (m *ModelThumb) ClearAll() (int, error) {
	return clearDir(m.base)
}

// Stats 返回 HDRI 缩略图缓存规模。
func (h *HDRI) Stats() CacheStats {
	dir := filepath.Join(filepath.Dir(h.ThumbPathFor("x")), "")
	// ThumbPathFor 返回 <thumbDir>/<hash>.png，取其目录
	dir = filepath.Dir(h.ThumbPathFor("probe.hdr"))
	files, bytes := dirStats(dir)
	return CacheStats{Kind: "disk", Label: "HDRI 缩略图", Files: files, Bytes: bytes}
}

// ClearAll 清空 HDRI 缩略图缓存并让列表缓存失效。
func (h *HDRI) ClearAll() (int, error) {
	dir := filepath.Dir(h.ThumbPathFor("probe.hdr"))
	n, err := clearDir(dir)
	if h.presetDir() != "" {
		h.InvalidateList(h.presetDir())
	}
	return n, err
}

// 编译期断言：确保 strings 未被误删（dirStats 未来可能用到路径判断）。
var _ = strings.TrimSpace
