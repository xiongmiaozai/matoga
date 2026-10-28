// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// ImportedModelHandler 处理 /api/imported-models 下的请求。
type ImportedModelHandler struct {
	Store *store.ImportedModelStore
	// Thumbs 用于删除模型时失效其缩略图缓存。
	Thumbs *media.ModelThumb
}

// Location 返回专属本地目录。
func (h *ImportedModelHandler) Location(w http.ResponseWriter, r *http.Request) error {
	dir := h.Store.Dir()
	httpx.OK(w, map[string]any{"dir": dir, "name": filepath.Base(dir)})
	return nil
}

// List 返回全部已导入模型。
func (h *ImportedModelHandler) List(w http.ResponseWriter, r *http.Request) error {
	models, err := h.Store.List()
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"models": models})
	return nil
}

// normalizeModelData 把请求里的 data 归一为待写入文件的字节。
//
// 前端可能把 data 传成 JSON 字符串（"data": "{...}"），也可能直接传
// JSON 对象（"data": {...}）。前者需要先解出字符串内容，否则落盘会多
// 一层引号；后者保留原始 JSON 文本。与 Node 版
// `typeof data === 'string' ? data : JSON.stringify(data)` 等价。
func normalizeModelData(raw json.RawMessage) ([]byte, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "data required")
	}
	if trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid data")
		}
		if s == "" {
			return nil, httpx.Errorf(httpx.CodeInvalidParam, "data required")
		}
		return []byte(s), nil
	}
	return trimmed, nil
}

// Save 导入模型，body {id?, name, data, ext?}。
func (h *ImportedModelHandler) Save(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		ID   string          `json:"id"`
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
		Ext  string          `json:"ext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	data, err := normalizeModelData(body.Data)
	if err != nil {
		return err
	}
	res, err := h.Store.Save(store.ImportedModelSaveInput{
		ID: body.ID, Name: body.Name, Data: data, Ext: body.Ext,
	})
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Load 读取模型。
func (h *ImportedModelHandler) Load(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	c, err := h.Store.Load(id)
	if err != nil {
		return err
	}
	httpx.OK(w, c)
	return nil
}

// Update 覆盖更新模型，body {data}。
func (h *ImportedModelHandler) Update(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	data, err := normalizeModelData(body.Data)
	if err != nil {
		return err
	}
	res, err := h.Store.Update(id, data)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Delete 删除模型，并失效其缩略图缓存。
func (h *ImportedModelHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	if err := h.Store.Delete(id); err != nil {
		return err
	}
	if h.Thumbs != nil {
		h.Thumbs.Invalidate("im:" + id)
	}
	httpx.OK(w, map[string]any{"id": id})
	return nil
}
