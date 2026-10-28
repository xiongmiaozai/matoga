// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// Services 汇总挂载路由所需的全部依赖。
type Services struct {
	Deps   *Deps
	Config *store.Config
	Thumbs *media.Thumb
	HDRI   *media.HDRI
	Assets *store.AssetStore
}

// Mount 把所有 API 挂到根路由。
//
// 新增资源时只改这里一处：main.go 与测试共用同一装配逻辑。
func Mount(r *httpx.Router, s Services) {
	// /api/health
	health := r.APIGroup("/health")
	health.Get("/", httpx.Wrap(s.Deps.Health))

	// /api/config
	cfg := &ConfigHandler{Store: s.Config}
	configGroup := r.APIGroup("/config")
	configGroup.Get("/", httpx.Wrap(cfg.Get))
	configGroup.Put("/", httpx.Wrap(cfg.Put))
	configGroup.Delete("/", httpx.Wrap(cfg.Clear))

	// /api/fs
	fsHandler := &FSHandler{}
	fsGroup := r.APIGroup("/fs")
	fsGroup.Get("/browse", httpx.Wrap(fsHandler.Browse))
	fsGroup.Get("/search", httpx.Wrap(fsHandler.Search))
	fsGroup.Post("/create", httpx.Wrap(fsHandler.Create))

	// /api/file
	fileHandler := &FileHandler{Thumbs: s.Thumbs}
	fileGroup := r.APIGroup("/file")
	fileGroup.Post("/hash", httpx.Wrap(fileHandler.Hash))
	fileGroup.Post("/copy", httpx.Wrap(fileHandler.Copy))
	fileGroup.Post("/backup", httpx.Wrap(fileHandler.Backup))
	fileGroup.Post("/delete", httpx.Wrap(fileHandler.Delete))
	fileGroup.Post("/thumb", httpx.Wrap(fileHandler.SaveThumb))
	fileGroup.Post("/write", httpx.Wrap(fileHandler.Write))
	fileGroup.Get("/raw", httpx.Wrap(fileHandler.Raw))
	fileGroup.Get("/thumb", httpx.Wrap(fileHandler.Thumb))
	fileGroup.Get("/thumb-info", httpx.Wrap(fileHandler.ThumbInfo))

	// /api/hdri
	hdriHandler := &HDRIHandler{Service: s.HDRI}
	hdriGroup := r.APIGroup("/hdri")
	hdriGroup.Get("/list", httpx.Wrap(hdriHandler.List))
	hdriGroup.Get("/thumb-info", httpx.Wrap(hdriHandler.ThumbInfo))
	hdriGroup.Get("/thumb", httpx.Wrap(hdriHandler.Thumb))
	hdriGroup.Post("/thumb", httpx.Wrap(hdriHandler.SaveThumb))
	hdriGroup.Post("/cleanup", httpx.Wrap(hdriHandler.Cleanup))

	// /api/asset
	assetHandler := &AssetHandler{Store: s.Assets, Config: s.Config}
	assetGroup := r.APIGroup("/asset")
	assetGroup.Get("/", httpx.Wrap(assetHandler.Get))
	assetGroup.Get("/type/{type}", httpx.Wrap(assetHandler.ByType))
	assetGroup.Get("/tex", httpx.Wrap(assetHandler.Tex))
	assetGroup.Get("/model", httpx.Wrap(assetHandler.Model))
	assetGroup.Get("/info", httpx.Wrap(assetHandler.Info))
	assetGroup.Put("/favorites", httpx.Wrap(assetHandler.SetFavorites))
	assetGroup.Put("/recent", httpx.Wrap(assetHandler.SetRecent))
}
