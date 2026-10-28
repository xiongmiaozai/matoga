// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
	"github.com/xiongmiaozai/matoga/backend/internal/upload"
)

// Services 汇总挂载路由所需的全部依赖。
type Services struct {
	Deps         *Deps
	Config       *store.Config
	Thumbs       *media.Thumb
	HDRI         *media.HDRI
	Assets       *store.AssetStore
	ModelThumbs  *media.ModelThumb
	Upload       *upload.Service
	PanelsDir    string
	Workspaces   *store.WorkspaceStore
	NodeProjects *store.NodeProjectStore
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
	assetHandler := &AssetHandler{Store: s.Assets, Config: s.Config, Thumbs: s.ModelThumbs}
	assetGroup := r.APIGroup("/asset")
	assetGroup.Get("/", httpx.Wrap(assetHandler.Get))
	assetGroup.Get("/type/{type}", httpx.Wrap(assetHandler.ByType))
	assetGroup.Get("/tex", httpx.Wrap(assetHandler.Tex))
	assetGroup.Get("/model", httpx.Wrap(assetHandler.Model))
	assetGroup.Get("/model-thumb-info", httpx.Wrap(assetHandler.ModelThumbInfo))
	assetGroup.Get("/model-thumb", httpx.Wrap(assetHandler.ModelThumb))
	assetGroup.Post("/model-thumb", httpx.Wrap(assetHandler.SaveModelThumb))
	assetGroup.Get("/info", httpx.Wrap(assetHandler.Info))
	assetGroup.Put("/favorites", httpx.Wrap(assetHandler.SetFavorites))
	assetGroup.Put("/recent", httpx.Wrap(assetHandler.SetRecent))

	// /api/shell（仅本地模式）
	shellHandler := &ShellHandler{}
	shellGroup := r.APIGroup("/shell")
	shellGroup.Use(s.Deps.Auth.RequireLocal)
	shellGroup.Post("/open", httpx.Wrap(shellHandler.Open))
	shellGroup.Post("/reveal", httpx.Wrap(shellHandler.Reveal))

	// /api/upload
	uploadHandler := &UploadHandler{Service: s.Upload}
	uploadGroup := r.APIGroup("/upload")
	uploadGroup.Post("/begin", httpx.Wrap(uploadHandler.Begin))
	uploadGroup.Put("/file", httpx.Wrap(uploadHandler.PutFile))
	uploadGroup.Post("/end", httpx.Wrap(uploadHandler.End))

	// /api/compare
	compareHandler := &CompareHandler{}
	compareGroup := r.APIGroup("/compare")
	compareGroup.Post("/scan", httpx.Wrap(compareHandler.Scan))

	// /api/panels
	panelsHandler := &PanelsHandler{Dir: s.PanelsDir}
	panelsGroup := r.APIGroup("/panels")
	panelsGroup.Get("/", httpx.Wrap(panelsHandler.List))

	// /api/workspace
	wsHandler := &WorkspaceHandler{Store: s.Workspaces}
	wsGroup := r.APIGroup("/workspace")
	wsGroup.Get("/", httpx.Wrap(wsHandler.Get))
	wsGroup.Put("/preset", httpx.Wrap(wsHandler.SavePreset))
	wsGroup.Delete("/preset", httpx.Wrap(wsHandler.DeletePreset))
	wsGroup.Put("/rename", httpx.Wrap(wsHandler.RenamePreset))
	wsGroup.Put("/active", httpx.Wrap(wsHandler.SetActive))

	// /api/node-projects
	npHandler := &NodeProjectHandler{Store: s.NodeProjects}
	npGroup := r.APIGroup("/node-projects")
	npGroup.Get("/", httpx.Wrap(npHandler.List))
	npGroup.Post("/", httpx.Wrap(npHandler.Save))
	npGroup.Get("/{id}", httpx.Wrap(npHandler.Load))
	npGroup.Delete("/{id}", httpx.Wrap(npHandler.Remove))
	npGroup.Put("/{id}/rename", httpx.Wrap(npHandler.Rename))
	npGroup.Get("/{id}/thumb", httpx.Wrap(npHandler.Thumb))
}
