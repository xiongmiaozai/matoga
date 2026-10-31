// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// ListTextures 处理 GET /api/imported-models/{id}/textures。
func (h *ImportedModelHandler) ListTextures(w http.ResponseWriter, r *http.Request) error {
	items, err := h.Store.ListTextures(chi.URLParam(r, "id"))
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, map[string]any{"textures": items})
	return nil
}

// SaveTextures 处理 POST /api/imported-models/{id}/textures。
//
// 请求体 {"textures": {"assets/ns/textures/block/a.png": "data:image/png;base64,..."}}。
func (h *ImportedModelHandler) SaveTextures(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Textures map[string]string `json:"textures"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	if body.Textures == nil {
		httpx.Fail(w, httpx.CodeInvalidParam, "textures map required")
		return nil
	}
	saved, err := h.Store.SaveTextures(chi.URLParam(r, "id"), body.Textures)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, map[string]any{"saved": saved, "count": len(saved)})
	return nil
}

// DeleteTexture 处理 DELETE /api/imported-models/{id}/textures。
//
// 路径从 body.path 或 query.path 取，二者都支持（DELETE 带 body 不普遍）。
func (h *ImportedModelHandler) DeleteTexture(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Query().Get("path")
	if p == "" && r.Body != nil {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			p = body.Path
		}
	}
	if p == "" {
		httpx.Fail(w, httpx.CodeInvalidParam, "path required")
		return nil
	}
	res, err := h.Store.DeleteTexture(chi.URLParam(r, "id"), p)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, res)
	return nil
}
