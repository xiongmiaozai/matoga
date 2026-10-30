// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/mcmeta"
	"github.com/xiongmiaozai/matoga/backend/internal/packbuilder"
)

// PackBuilderHandler 提供 /api/pack-builder 的资源包自动创建。
type PackBuilderHandler struct {
	// DestRoot 返回默认输出根目录（mcPacksPath）。
	// 用函数而非字符串：用户运行中改路径后应立即生效。
	DestRoot func() string
}

// Formats 处理 GET /api/pack-builder/formats。
//
// 直接复用 mcmeta 的 pack_format 映射表，不另建常量，
// 避免与版本对照表两处定义漂移。
func (h *PackBuilderHandler) Formats(w http.ResponseWriter, r *http.Request) error {
	out := make([]mcmeta.FormatVersion, len(mcmeta.PackFormatVersions))
	copy(out, mcmeta.PackFormatVersions)
	httpx.OK(w, map[string]any{"formats": out})
	return nil
}

// Build 处理 POST /api/pack-builder/build。
func (h *PackBuilderHandler) Build(w http.ResponseWriter, r *http.Request) error {
	var req packbuilder.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	if req.DestRoot == "" && h.DestRoot != nil {
		req.DestRoot = h.DestRoot()
	}
	res, err := packbuilder.Build(req)
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, err.Error())
	}
	httpx.OK(w, res)
	return nil
}
