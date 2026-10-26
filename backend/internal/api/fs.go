// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// FSHandler 提供 /api/fs 的目录浏览、搜索与新建目录。
type FSHandler struct{}

// Browse 列出目录；path 为空时返回盘符/主目录列表。
func (h *FSHandler) Browse(w http.ResponseWriter, r *http.Request) error {
	raw := r.URL.Query().Get("path")
	if raw == "" {
		p, parent, dirs, err := fsx.Browse("")
		if err != nil {
			return err
		}
		httpx.OK(w, map[string]any{"path": p, "parent": parent, "dirs": dirs})
		return nil
	}
	guard, err := fsx.GuardRead(raw)
	if err != nil {
		return err
	}
	p, parent, dirs, err := fsx.Browse(guard)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"path": p, "parent": parent, "dirs": dirs})
	return nil
}

// Search 按名字搜索子目录。
func (h *FSHandler) Search(w http.ResponseWriter, r *http.Request) error {
	root, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		httpx.OK(w, map[string]any{"results": []fsx.DirEntry{}})
		return nil
	}
	maxDepth := clampInt(atoiDefault(r.URL.Query().Get("depth"), 3), 0, 6)
	limit := clampInt(atoiDefault(r.URL.Query().Get("limit"), 200), 1, 500)
	results := fsx.Search(root, q, maxDepth, limit)
	if len(results) > limit {
		results = results[:limit]
	}
	httpx.OK(w, map[string]any{"results": results})
	return nil
}

// Create 新建目录。
func (h *FSHandler) Create(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	res, err := fsx.CreateFolder(p)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
