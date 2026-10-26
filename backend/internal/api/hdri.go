// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
)

// HDRIHandler 提供 /api/hdri 的预设列表与缩略图。
type HDRIHandler struct {
	Service *media.HDRI
}

// List 返回 HDR 预设目录下的文件。
func (h *HDRIHandler) List(w http.ResponseWriter, r *http.Request) error {
	list, err := h.Service.List()
	if err != nil {
		return err
	}
	httpx.OK(w, list)
	return nil
}

// ThumbInfo 返回缩略图状态。
func (h *HDRIHandler) ThumbInfo(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	info, err := h.Service.ThumbInfo(p)
	if err != nil {
		httpx.Fail(w, httpx.CodeFSNotFound, err.Error())
		return nil
	}
	httpx.OK(w, info)
	return nil
}

// Thumb 返回缩略图（不存在则即时生成）。
func (h *HDRIHandler) Thumb(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	thumbPath, err := h.Service.EnsureThumb(p)
	if err != nil {
		httpx.Fail(w, httpx.CodeFS, err.Error())
		return nil
	}
	http.ServeFile(w, r, thumbPath)
	return nil
}

// SaveThumb 保存前端生成的缩略图。
func (h *HDRIHandler) SaveThumb(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Path    string `json:"path"`
		DataURL string `json:"dataUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(body.DataURL, "data:image/") {
		httpx.Fail(w, httpx.CodeInvalidParam, "invalid dataUrl")
		return nil
	}
	result, err := h.Service.SaveThumb(p, body.DataURL)
	if err != nil {
		return err
	}
	httpx.OK(w, result)
	return nil
}

// Cleanup 删除孤儿缩略图。
func (h *HDRIHandler) Cleanup(w http.ResponseWriter, r *http.Request) error {
	result, err := h.Service.CleanupOrphans()
	if err != nil {
		return err
	}
	httpx.OK(w, result)
	return nil
}
