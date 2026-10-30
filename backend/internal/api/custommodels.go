// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// CustomModelHandler 处理 /api/custom-models 下的请求。
type CustomModelHandler struct {
	Store  *store.CustomModelStore
	Thumbs *media.ModelThumb
	// PackRoot 返回 sync-pack 的目标根目录（mcPacksPath）。
	// 用函数而非字符串：用户在运行中修改路径后应立即生效。
	PackRoot func() string
}

// Templates 返回可用模板列表。
func (h *CustomModelHandler) Templates(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, map[string]any{"templates": store.ListCustomTemplates()})
	return nil
}

// Location 返回专属本地目录。
func (h *CustomModelHandler) Location(w http.ResponseWriter, r *http.Request) error {
	dir := h.Store.Dir()
	httpx.OK(w, map[string]any{"dir": dir, "name": filepath.Base(dir)})
	return nil
}

// List 返回已创建模型列表。
func (h *CustomModelHandler) List(w http.ResponseWriter, r *http.Request) error {
	models, err := h.Store.List()
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"models": models})
	return nil
}

// Create 从模板创建模型，body {template, name, namespace?}。
func (h *CustomModelHandler) Create(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Template  string `json:"template"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	if body.Template == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "template required")
	}
	if body.Name == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "name required")
	}
	res, err := h.Store.Create(body.Template, body.Name, body.Namespace)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Load 读取模型记录。
func (h *CustomModelHandler) Load(w http.ResponseWriter, r *http.Request) error {
	res, err := h.Store.Load(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Raw 只返回记录里的 model 字段。
func (h *CustomModelHandler) Raw(w http.ResponseWriter, r *http.Request) error {
	res, err := h.Store.Load(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var rec struct {
		Model json.RawMessage `json:"model"`
	}
	if len(res.JSON) == 0 || json.Unmarshal(res.JSON, &rec) != nil ||
		len(rec.Model) == 0 || string(rec.Model) == "null" {
		return httpx.Errorf(httpx.CodeNotFound, "model json not found")
	}
	httpx.OK(w, rec.Model)
	return nil
}

// Update 更新 {model?, name?}。
func (h *CustomModelHandler) Update(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	var body struct {
		Model json.RawMessage `json:"model"`
		Name  *string         `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	hasModel := len(body.Model) > 0 && string(body.Model) != "null"
	if !hasModel && body.Name == nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "model or name required")
	}
	res, err := h.Store.Update(id, body.Model, hasModel, body.Name)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Delete 删除模型并失效缩略图缓存。
func (h *CustomModelHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	res, err := h.Store.Delete(id)
	if err != nil {
		return err
	}
	if h.Thumbs != nil {
		h.Thumbs.Invalidate("cm:" + id)
	}
	httpx.OK(w, res)
	return nil
}
