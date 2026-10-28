// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// AssetHandler 提供 /api/asset 的资产库读写。
type AssetHandler struct {
	Store *store.AssetStore
}

// Get 返回收藏夹与最近使用。
func (h *AssetHandler) Get(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Store.Get())
	return nil
}

// ByType 按分类返回。
func (h *AssetHandler) ByType(w http.ResponseWriter, r *http.Request) error {
	t := chi.URLParam(r, "type")
	if t == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid asset type")
	}
	httpx.OK(w, h.Store.GetByType(t))
	return nil
}

// SetFavorites 保存收藏夹。
func (h *AssetHandler) SetFavorites(w http.ResponseWriter, r *http.Request) error {
	items, err := decodeItems(r)
	if err != nil {
		return err
	}
	n, err := h.Store.SetFavorites(items)
	if err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, map[string]any{"count": n})
	return nil
}

// SetRecent 保存最近使用。
func (h *AssetHandler) SetRecent(w http.ResponseWriter, r *http.Request) error {
	items, err := decodeItems(r)
	if err != nil {
		return err
	}
	n, err := h.Store.SetRecent(items)
	if err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, map[string]any{"count": n})
	return nil
}

func decodeItems(r *http.Request) ([]any, error) {
	var body struct {
		Items []any `json:"items"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err.Error() != "EOF" {
			return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
		}
	}
	return body.Items, nil
}

// Info 返回文件 stat，用于详情面板。
func (h *AssetHandler) Info(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	st, err := os.Stat(p)
	if err != nil {
		httpx.OK(w, map[string]any{
			"exists": false, "isDirectory": false, "size": 0, "mtime": 0,
		})
		return nil
	}
	httpx.OK(w, map[string]any{
		"exists":      true,
		"isDirectory": st.IsDir(),
		"size":        st.Size(),
		"mtime":       float64(st.ModTime().UnixMilli()),
	})
	return nil
}
