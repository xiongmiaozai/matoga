// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/theme"
)

// ThemeHandler 提供 /api/themes 的读写。
type ThemeHandler struct {
	Store *theme.Store
}

// List 处理 GET /api/themes。
func (h *ThemeHandler) List(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Store.List())
	return nil
}

// Get 处理 GET /api/themes/{id}；不存在返回 null。
func (h *ThemeHandler) Get(w http.ResponseWriter, r *http.Request) error {
	t := h.Store.Get(chi.URLParam(r, "id"))
	if t == nil {
		httpx.OK(w, nil)
		return nil
	}
	httpx.OK(w, t)
	return nil
}

// Put 处理 PUT /api/themes/{id}。
func (h *ThemeHandler) Put(w http.ResponseWriter, r *http.Request) error {
	var def theme.Theme
	if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	rec, err := h.Store.Put(chi.URLParam(r, "id"), def)
	if err != nil {
		return err
	}
	httpx.OK(w, rec)
	return nil
}

// Delete 处理 DELETE /api/themes/{id}。
func (h *ThemeHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	removed, err := h.Store.Delete(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"removed": removed})
	return nil
}

// Import 处理 POST /api/themes/import。
func (h *ThemeHandler) Import(w http.ResponseWriter, r *http.Request) error {
	var def theme.Theme
	if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	rec, err := h.Store.Import(def)
	if err != nil {
		return err
	}
	httpx.OK(w, rec)
	return nil
}
