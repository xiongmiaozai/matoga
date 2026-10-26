// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// ConfigHandler 提供 /api/config 的读写。
type ConfigHandler struct {
	Store *store.Config
}

// Get 返回配置。
func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Store.Get())
	return nil
}

// Put 合并写入配置。
func (h *ConfigHandler) Put(w http.ResponseWriter, r *http.Request) error {
	var patch map[string]any
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&patch)
	}
	if err := h.Store.Put(patch); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// Clear 重置配置。
func (h *ConfigHandler) Clear(w http.ResponseWriter, r *http.Request) error {
	if err := h.Store.Clear(); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}
