// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/syncpack"
)

// syncPackBody 是两个 sync-pack 端点共用的请求体。
type syncPackBody struct {
	PackName string `json:"packName"`
	RelPath  string `json:"relPath"`
}

// decodeSyncPackBody 解析并校验公共参数。
func decodeSyncPackBody(r *http.Request) (*syncPackBody, error) {
	var body syncPackBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	if body.PackName == "" {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "packName required")
	}
	if body.RelPath == "" {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "relPath required")
	}
	return &body, nil
}

// SyncPack 处理 POST /api/imported-models/{id}/sync-pack。
//
// 读取该模型当前的 JSON，写入 <mcPacksPath>/<packName>/<relPath>，
// 使 Minecraft 可直接加载这个模型。
func (h *ImportedModelHandler) SyncPack(w http.ResponseWriter, r *http.Request) error {
	body, err := decodeSyncPackBody(r)
	if err != nil {
		return err
	}
	content, err := h.Store.Load(chi.URLParam(r, "id"))
	if err != nil || content == nil || content.Raw == "" {
		httpx.Fail(w, httpx.CodeNotFound, "model json not found")
		return nil
	}
	res, err := syncpack.SyncModelJSON(h.packRoot(), body.PackName, body.RelPath, content.Raw)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, res)
	return nil
}

// packRoot 安全求值 PackRoot，未注入时返回空串。
func (h *ImportedModelHandler) packRoot() string {
	if h.PackRoot == nil {
		return ""
	}
	return h.PackRoot()
}

// SyncPack 处理 POST /api/custom-models/{id}/sync-pack。
func (h *CustomModelHandler) SyncPack(w http.ResponseWriter, r *http.Request) error {
	body, err := decodeSyncPackBody(r)
	if err != nil {
		return err
	}
	content, err := h.Store.Load(chi.URLParam(r, "id"))
	if err != nil || content == nil || content.Raw == "" {
		httpx.Fail(w, httpx.CodeNotFound, "model json not found")
		return nil
	}
	res, err := syncpack.SyncModelJSON(h.packRoot(), body.PackName, body.RelPath, content.Raw)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, res)
	return nil
}

// packRoot 安全求值 PackRoot，未注入时返回空串。
func (h *CustomModelHandler) packRoot() string {
	if h.PackRoot == nil {
		return ""
	}
	return h.PackRoot()
}
