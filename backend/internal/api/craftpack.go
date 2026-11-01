// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/craftpack"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// CraftPackHandler 处理 /api/craft-pack 下的请求。
type CraftPackHandler struct {
	Svc *craftpack.Service
}

// Get 返回自选清单（条目附加 locatePath）。
func (h *CraftPackHandler) Get(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, map[string]any{"items": h.Svc.SelectionWithLocate()})
	return nil
}

// PutItems 覆盖保存自选清单，body {items}。
func (h *CraftPackHandler) PutItems(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Items []any `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	list, err := h.Svc.SetSelection(body.Items)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"count": len(list)})
	return nil
}

// PostItem 追加条目，body {item}。
func (h *CraftPackHandler) PostItem(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Item map[string]any `json:"item"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	res, err := h.Svc.AddItem(body.Item)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// DeleteItem 按 key 移除条目（key 需 encodeURIComponent）。
func (h *CraftPackHandler) DeleteItem(w http.ResponseWriter, r *http.Request) error {
	raw := chi.URLParam(r, "key")
	key, err := url.PathUnescape(raw)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "bad key")
	}
	res, err := h.Svc.RemoveItem(key)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// DeleteItems 清空自选清单。
func (h *CraftPackHandler) DeleteItems(w http.ResponseWriter, r *http.Request) error {
	res, err := h.Svc.ClearSelection()
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Copy 存入制作包，body {item}。
func (h *CraftPackHandler) Copy(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Item map[string]any `json:"item"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	res, err := h.Svc.CopyToCraftPack(body.Item)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Export 聚合导出，body {name?, description?, packFormat?, items?}。
func (h *CraftPackHandler) Export(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		PackFormat  json.RawMessage `json:"packFormat"`
		Items       json.RawMessage `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	opts := craftpack.ExportOptions{
		Name:        body.Name,
		Description: body.Description,
	}
	if len(body.PackFormat) > 0 && string(body.PackFormat) != "null" {
		var f float64
		if json.Unmarshal(body.PackFormat, &f) == nil {
			opts.PackFormat = f
			opts.HasFormat = true
		}
	}
	if len(body.Items) > 0 && string(body.Items) != "null" {
		var arr []any
		if json.Unmarshal(body.Items, &arr) == nil {
			opts.Items = arr
			opts.HasItems = true
		}
	}
	res, err := h.Svc.Export(opts)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// Packs 列出已导出制作包。
func (h *CraftPackHandler) Packs(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Svc.ListPacks())
	return nil
}

// Current 返回当前制作包项目。
func (h *CraftPackHandler) Current(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Svc.Current())
	return nil
}
