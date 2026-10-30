// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/mcmeta"
)

// PackRootResolver 返回某个挂载点的包根目录。
type PackRootResolver func() string

// PackHandler 处理 /craft-packs、/mc-packs、/mc-official 三个挂载点的包路由。
// 三者的差别仅在包根目录与是否暴露 version-map。
type PackHandler struct {
	Root           PackRootResolver
	WithVersionMap bool
}

// NewPackHandler 构造 PackHandler。
func NewPackHandler(root PackRootResolver, withVersionMap bool) *PackHandler {
	return &PackHandler{Root: root, WithVersionMap: withVersionMap}
}

// List 列出包根下的全部资源包。
func (h *PackHandler) List(w http.ResponseWriter, r *http.Request) error {
	out, err := mcmeta.ListOfficialPacks(h.Root())
	if err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, out)
	return nil
}

// VersionMap 返回 pack_format 与 MC 版本的对照表。
func (h *PackHandler) VersionMap(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, map[string]any{"map": mcmeta.PackFormatVersions})
	return nil
}

// TexIndex 扁平收集包根下全部贴图相对路径（去重），供前端校验模型贴图引用。
func (h *PackHandler) TexIndex(w http.ResponseWriter, r *http.Request) error {
	paths, err := mcmeta.ListAllTexPaths(h.Root())
	if err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, map[string]any{"paths": paths})
	return nil
}

// Rename 重命名资源包。
func (h *PackHandler) Rename(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	root := h.Root()
	if _, err := fsx.GuardWrite(filepath.Join(root, body.From)); err != nil {
		return err
	}
	if _, err := fsx.GuardWrite(filepath.Join(root, body.To)); err != nil {
		return err
	}
	out, err := mcmeta.RenamePack(root, body.From, body.To)
	if err != nil {
		msg := err.Error()
		switch {
		case strings.Contains(msg, "already exists"):
			return httpx.Errorf(httpx.CodeAlreadyExists, msg)
		case strings.Contains(msg, "not found"):
			return httpx.Errorf(httpx.CodeFSNotFound, msg)
		default:
			return httpx.Errorf(httpx.CodeInvalidParam, msg)
		}
	}
	httpx.OK(w, out)
	return nil
}

// Textures 列出包内贴图（分类 + 目录浏览 + 分页）。
func (h *PackHandler) Textures(w http.ResponseWriter, r *http.Request) error {
	name := chi.URLParam(r, "name")
	q := r.URL.Query()
	out, err := mcmeta.ListPackTextures(h.Root(), name, q.Get("dir"), q.Get("offset"), q.Get("limit"))
	if err != nil {
		return packErr(err)
	}
	httpx.OK(w, out)
	return nil
}

// Entries 列出包内任意目录的直接子项。
func (h *PackHandler) Entries(w http.ResponseWriter, r *http.Request) error {
	name := chi.URLParam(r, "name")
	out, err := mcmeta.ListPackEntries(h.Root(), name, r.URL.Query().Get("dir"))
	if err != nil {
		return packErr(err)
	}
	httpx.OK(w, out)
	return nil
}

// Raw 读取包内文件字节（目录直读 / zip 提取）。
func (h *PackHandler) Raw(w http.ResponseWriter, r *http.Request) error {
	name := chi.URLParam(r, "name")
	q := r.URL.Query()
	pf, err := mcmeta.ReadPackFile(h.Root(), name, q.Get("path"), q.Get("any") == "1")
	if err != nil {
		return packErr(err)
	}
	w.Header().Set("Content-Type", pf.Mime)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pf.Buf)
	return nil
}

// packErr 把 mcmeta 的错误映射成 API 错误码。
func packErr(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "invalid"):
		return httpx.Errorf(httpx.CodeInvalidParam, msg)
	case strings.Contains(msg, "not found"):
		return httpx.Errorf(httpx.CodeFSNotFound, msg)
	case strings.Contains(msg, "not a zip"), strings.Contains(msg, "zip"):
		return httpx.Errorf(httpx.CodeMcNotZip, msg)
	default:
		return httpx.Errorf(httpx.CodeFS, msg)
	}
}
