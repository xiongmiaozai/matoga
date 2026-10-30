// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"github.com/xiongmiaozai/matoga/backend/internal/craftpack"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/lang"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
	"github.com/xiongmiaozai/matoga/backend/internal/theme"
	"github.com/xiongmiaozai/matoga/backend/internal/upload"
)

// Services 汇总挂载路由所需的全部依赖。
type Services struct {
	Deps           *Deps
	Config         *store.Config
	Thumbs         *media.Thumb
	HDRI           *media.HDRI
	Assets         *store.AssetStore
	ModelThumbs    *media.ModelThumb
	Upload         *upload.Service
	PanelsDir      string
	Workspaces     *store.WorkspaceStore
	NodeProjects   *store.NodeProjectStore
	ImportedModels *store.ImportedModelStore
	CustomModels   *store.CustomModelStore
	CraftPack      *craftpack.Service
	Lang           *lang.Service
	Themes         *theme.Store
	// CraftPacksRoot / McPacksRoot / McOfficialRoot 是三个包路由的根目录解析器。
	// 走函数而不是字符串，是为了每次请求都读最新配置（用户可在运行时改路径）。
	CraftPacksRoot func() string
	McPacksRoot    func() string
	McOfficialRoot func() string
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
	fileGroup.Post("/thumb-info-batch", httpx.Wrap(fileHandler.ThumbInfoBatch))

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
	assetGroup.Get("/model-cross", httpx.Wrap(assetHandler.ModelCross))
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

	// /api/imported-models
	imHandler := &ImportedModelHandler{
		Store:    s.ImportedModels,
		Thumbs:   s.ModelThumbs,
		PackRoot: s.McPacksRoot,
	}
	imGroup := r.APIGroup("/imported-models")
	imGroup.Get("/location", httpx.Wrap(imHandler.Location))
	imGroup.Get("/", httpx.Wrap(imHandler.List))
	imGroup.Post("/", httpx.Wrap(imHandler.Save))
	imGroup.Get("/{id}", httpx.Wrap(imHandler.Load))
	imGroup.Put("/{id}", httpx.Wrap(imHandler.Update))
	imGroup.Delete("/{id}", httpx.Wrap(imHandler.Delete))
	imGroup.Get("/{id}/textures", httpx.Wrap(imHandler.ListTextures))
	imGroup.Post("/{id}/textures", httpx.Wrap(imHandler.SaveTextures))
	imGroup.Delete("/{id}/textures", httpx.Wrap(imHandler.DeleteTexture))
	imGroup.Post("/{id}/sync-pack", httpx.Wrap(imHandler.SyncPack))

	// /api/custom-models
	cmHandler := &CustomModelHandler{
		Store:    s.CustomModels,
		Thumbs:   s.ModelThumbs,
		PackRoot: s.McPacksRoot,
	}
	cmGroup := r.APIGroup("/custom-models")
	cmGroup.Get("/templates", httpx.Wrap(cmHandler.Templates))
	cmGroup.Get("/location", httpx.Wrap(cmHandler.Location))
	cmGroup.Get("/", httpx.Wrap(cmHandler.List))
	cmGroup.Post("/", httpx.Wrap(cmHandler.Create))
	cmGroup.Get("/{id}", httpx.Wrap(cmHandler.Load))
	cmGroup.Get("/{id}/raw", httpx.Wrap(cmHandler.Raw))
	cmGroup.Put("/{id}", httpx.Wrap(cmHandler.Update))
	cmGroup.Delete("/{id}", httpx.Wrap(cmHandler.Delete))
	cmGroup.Post("/{id}/sync-pack", httpx.Wrap(cmHandler.SyncPack))

	// /api/craft-pack
	cpHandler := &CraftPackHandler{Svc: s.CraftPack}
	cpGroup := r.APIGroup("/craft-pack")
	cpGroup.Get("/", httpx.Wrap(cpHandler.Get))
	cpGroup.Put("/items", httpx.Wrap(cpHandler.PutItems))
	cpGroup.Post("/items", httpx.Wrap(cpHandler.PostItem))
	cpGroup.Delete("/items/{key}", httpx.Wrap(cpHandler.DeleteItem))
	cpGroup.Delete("/items", httpx.Wrap(cpHandler.DeleteItems))
	cpGroup.Post("/copy", httpx.Wrap(cpHandler.Copy))
	cpGroup.Post("/export", httpx.Wrap(cpHandler.Export))
	cpGroup.Get("/packs", httpx.Wrap(cpHandler.Packs))
	cpGroup.Get("/current", httpx.Wrap(cpHandler.Current))

	// /api/craft-packs、/api/mc-packs、/api/mc-official
	// 三者共用同一套包路由，差别只在根目录与是否暴露 version-map。
	mountPackGroup(r, "/craft-packs", s.CraftPacksRoot, false)
	mountPackGroup(r, "/mc-packs", s.McPacksRoot, false)
	mountPackGroup(r, "/mc-official", s.McOfficialRoot, true)

	// /api/lang
	if s.Lang != nil {
		langHandler := &LangHandler{
			Service:      s.Lang,
			OfficialRoot: s.McOfficialRoot,
			McPacksRoot:  s.McPacksRoot,
		}
		langGroup := r.APIGroup("/lang")
		langGroup.Get("/zh", httpx.Wrap(langHandler.ZH))
	}

	// /api/cache
	if s.Lang != nil {
		cacheHandler := &CacheHandler{
			Thumbs:      s.Thumbs,
			ModelThumbs: s.ModelThumbs,
			HDRI:        s.HDRI,
			Lang:        s.Lang,
		}
		cacheGroup := r.APIGroup("/cache")
		cacheGroup.Get("/stats", httpx.Wrap(cacheHandler.Stats))
		cacheGroup.Post("/clear", httpx.Wrap(cacheHandler.Clear))
		cacheGroup.Post("/clear-all", httpx.Wrap(cacheHandler.ClearAll))
		cacheGroup.Post("/hdri-orphans", httpx.Wrap(cacheHandler.HDRIOrphans))
	}

	// /api/pack-builder
	pbHandler := &PackBuilderHandler{DestRoot: s.McPacksRoot}
	pbGroup := r.APIGroup("/pack-builder")
	pbGroup.Get("/formats", httpx.Wrap(pbHandler.Formats))
	pbGroup.Post("/build", httpx.Wrap(pbHandler.Build))

	// /api/themes
	if s.Themes != nil {
		themeHandler := &ThemeHandler{Store: s.Themes}
		themeGroup := r.APIGroup("/themes")
		themeGroup.Get("/", httpx.Wrap(themeHandler.List))
		themeGroup.Post("/import", httpx.Wrap(themeHandler.Import))
		themeGroup.Get("/{id}", httpx.Wrap(themeHandler.Get))
		themeGroup.Put("/{id}", httpx.Wrap(themeHandler.Put))
		themeGroup.Delete("/{id}", httpx.Wrap(themeHandler.Delete))
	}
}

// mountPackGroup 挂载一个包路由分组（5 个基础端点 + 可选 version-map）。
func mountPackGroup(r *httpx.Router, prefix string, root func() string, versionMap bool) {
	if root == nil {
		return
	}
	h := NewPackHandler(root, versionMap)
	g := r.APIGroup(prefix)
	g.Get("/list", httpx.Wrap(h.List))
	if versionMap {
		g.Get("/version-map", httpx.Wrap(h.VersionMap))
		// 静态路径必须注册在 /{name} 通配之前，否则会被通配吞掉。
		g.Get("/tex-index", httpx.Wrap(h.TexIndex))
	}
	g.Put("/rename", httpx.Wrap(h.Rename))
	g.Get("/{name}/textures", httpx.Wrap(h.Textures))
	g.Get("/{name}/entries", httpx.Wrap(h.Entries))
	g.Get("/{name}/raw", httpx.Wrap(h.Raw))
}
