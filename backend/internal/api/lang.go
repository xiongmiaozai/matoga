// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"net/http"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/lang"
)

// LangHandler 提供 /api/lang 的中文译名映射。
type LangHandler struct {
	Service *lang.Service
	// OfficialRoot / McPacksRoot 是包根目录解析器；走函数以便每次请求读最新配置。
	OfficialRoot func() string
	McPacksRoot  func() string
}

// ZH 处理 GET /api/lang/zh。
//
//	?refresh=1  强制重建缓存
func (h *LangHandler) ZH(w http.ResponseWriter, r *http.Request) error {
	if r.URL.Query().Get("refresh") == "1" {
		h.Service.Invalidate()
	}
	var roots []string
	if h.OfficialRoot != nil {
		roots = append(roots, h.OfficialRoot())
	}
	if h.McPacksRoot != nil {
		roots = append(roots, h.McPacksRoot())
	}
	httpx.OK(w, h.Service.Get(roots))
	return nil
}
