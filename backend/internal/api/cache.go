// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/lang"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
)

// CacheHandler 提供 /api/cache 的统一缓存管理。
//
// 覆盖 5 类缓存：贴图缩略图、模型缩略图、HDRI 缩略图（磁盘），
// 文件哈希、译名映射（内存）。
type CacheHandler struct {
	Thumbs      *media.Thumb
	ModelThumbs *media.ModelThumb
	HDRI        *media.HDRI
	Lang        *lang.Service
}

// cacheEntry 描述一类缓存的统计与清理方式。
type cacheEntry struct {
	kind  string
	label string
	stats func() map[string]any
	clear func() (any, error)
}

// entries 返回全部缓存条目。顺序固定，便于前端稳定渲染。
func (h *CacheHandler) entries() []struct {
	key string
	e   cacheEntry
} {
	return []struct {
		key string
		e   cacheEntry
	}{
		{"thumbs", cacheEntry{
			kind: "disk", label: "贴图缩略图",
			stats: func() map[string]any {
				s := h.Thumbs.Stats()
				return map[string]any{"files": s.Files, "bytes": s.Bytes}
			},
			clear: func() (any, error) {
				n, err := h.Thumbs.ClearAll()
				return map[string]any{"removed": n}, err
			},
		}},
		{"model-thumbs", cacheEntry{
			kind: "disk", label: "模型缩略图",
			stats: func() map[string]any {
				s := h.ModelThumbs.Stats()
				return map[string]any{"files": s.Files, "bytes": s.Bytes}
			},
			clear: func() (any, error) {
				n, err := h.ModelThumbs.ClearAll()
				return map[string]any{"removed": n}, err
			},
		}},
		{"hdri-thumbs", cacheEntry{
			kind: "disk", label: "HDRI 缩略图",
			stats: func() map[string]any {
				s := h.HDRI.Stats()
				return map[string]any{"files": s.Files, "bytes": s.Bytes}
			},
			clear: func() (any, error) {
				n, err := h.HDRI.ClearAll()
				return map[string]any{"removed": n}, err
			},
		}},
		{"hash-mem", cacheEntry{
			kind: "mem", label: "文件哈希缓存",
			stats: func() map[string]any {
				m := fsx.HashCacheStats()
				out := make(map[string]any, len(m))
				for k, v := range m {
					out[k] = v
				}
				return out
			},
			clear: func() (any, error) {
				fsx.InvalidateHash("")
				m := fsx.HashCacheStats()
				out := make(map[string]any, len(m))
				for k, v := range m {
					out[k] = v
				}
				return out, nil
			},
		}},
		{"lang-mem", cacheEntry{
			kind: "mem", label: "译名映射缓存",
			stats: func() map[string]any { return h.Lang.Stats() },
			clear: func() (any, error) {
				h.Lang.Invalidate()
				return h.Lang.Stats(), nil
			},
		}},
	}
}

// Stats 处理 GET /api/cache/stats。
func (h *CacheHandler) Stats(w http.ResponseWriter, r *http.Request) error {
	out := make(map[string]any, 5)
	for _, it := range h.entries() {
		v := it.e.stats()
		v["kind"] = it.e.kind
		v["label"] = it.e.label
		out[it.key] = v
	}
	httpx.OK(w, out)
	return nil
}

// Clear 处理 POST /api/cache/clear，body: {"target": "..."}。
func (h *CacheHandler) Clear(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	for _, it := range h.entries() {
		if it.key != body.Target {
			continue
		}
		res, err := it.e.clear()
		if err != nil {
			return err
		}
		httpx.OK(w, map[string]any{"target": body.Target, "result": res})
		return nil
	}
	httpx.Fail(w, httpx.CodeInvalidParam, "unknown cache target: "+body.Target)
	return nil
}

// ClearAll 处理 POST /api/cache/clear-all。
func (h *CacheHandler) ClearAll(w http.ResponseWriter, r *http.Request) error {
	out := make(map[string]any, 5)
	for _, it := range h.entries() {
		res, err := it.e.clear()
		if err != nil {
			return err
		}
		out[it.key] = res
	}
	httpx.OK(w, out)
	return nil
}

// HDRIOrphans 处理 POST /api/cache/hdri-orphans。
func (h *CacheHandler) HDRIOrphans(w http.ResponseWriter, r *http.Request) error {
	res, err := h.HDRI.CleanupOrphans()
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}
