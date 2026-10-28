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
	"github.com/xiongmiaozai/matoga/backend/internal/mcmeta"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// AssetHandler 提供 /api/asset 的资产库读写。
type AssetHandler struct {
	Store  *store.AssetStore
	Config *store.Config
}

// Get 返回收藏夹与最近使用。
func (h *AssetHandler) Get(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Store.Get())
	return nil
}

// Tex 聚合 MC 材质包与官方材质包的全部贴图（每包按 textures/ 第一级类别分组）。
func (h *AssetHandler) Tex(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, map[string]any{"packs": h.collect(r, mcmeta.ListPackTexGroups)})
	return nil
}

// Model 聚合 MC 材质包与官方材质包的全部模型（每包按 models/ 第一级类别分组）。
func (h *AssetHandler) Model(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, map[string]any{"packs": h.collect(r, mcmeta.ListPackModelGroups)})
	return nil
}

// sourcedPack 在 PackGroups 上补 source 字段（mc / official）。
type sourcedPack struct {
	*mcmeta.PackGroups
	Source string `json:"source"`
}

// collect 依次收集 MC 包与官方包，并标注来源。
func (h *AssetHandler) collect(r *http.Request, lister func(root, name string) (*mcmeta.PackGroups, error)) []sourcedPack {
	if h.Config == nil {
		return []sourcedPack{}
	}
	cfg := h.Config.Get()
	rootOf := func(m map[string]any, key string) string {
		if v, ok := m[key].(string); ok {
			return v
		}
		return ""
	}
	mcRoot := rootOf(cfg, "mcPacksPath")
	offRoot := rootOf(cfg, "officialPacksPath")

	out := make([]sourcedPack, 0, 8)
	for _, p := range mcmeta.ListPacks(mcRoot, lister) {
		out = append(out, sourcedPack{PackGroups: &p, Source: "mc"})
	}
	for _, p := range mcmeta.ListPacks(offRoot, lister) {
		out = append(out, sourcedPack{PackGroups: &p, Source: "official"})
	}
	return out
}

// ByType 按分类返回。非法分类与 Node 版一致地返回 ERR_INVALID_PARAM。
func (h *AssetHandler) ByType(w http.ResponseWriter, r *http.Request) error {
	t := chi.URLParam(r, "type")
	if !store.ValidType(t) {
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
