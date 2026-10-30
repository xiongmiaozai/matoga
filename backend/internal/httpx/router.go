// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package httpx

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Router 是应用根路由。
type Router struct {
	*chi.Mux
}

// NewRouter 装配根路由与全局中间件（log → recover → auth）。
func NewRouter(auth *Auth, log *slog.Logger) *Router {
	r := chi.NewRouter()
	r.Use(Recover(log))
	r.Use(RequestLogger(log))
	r.Use(auth.Middleware)
	return &Router{Mux: r}
}

// APIGroup 在 /api 下建一个子路由。
func (r *Router) APIGroup(prefix string) chi.Router {
	sub := chi.NewRouter()
	r.Mount("/api"+prefix, sub)
	return sub
}

// Static 挂载前端静态目录；找不到文件时回退 index.html（SPA）。
//
// 目录不存在时静默跳过：迁移期 backend 可先独立跑 API。
func (r *Router) Static(dir string) error {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil
	}
	indexPath := filepath.Join(dir, "index.html")
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		rel := strings.TrimPrefix(req.URL.Path, "/")
		if rel == "" {
			http.ServeFile(w, req, indexPath)
			return
		}
		target := filepath.Join(dir, filepath.FromSlash(rel))
		if st, err := os.Stat(target); err == nil && !st.IsDir() {
			http.ServeFile(w, req, target)
			return
		}
		http.ServeFile(w, req, indexPath)
	})
	return nil
}
