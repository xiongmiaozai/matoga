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

// Vendor 挂载第三方前端依赖，路径与 Node 侧一致：
//
//	/vendor/three              <nm>/three/build
//	/vendor/golden-layout      <nm>/golden-layout/dist/esm（缺扩展名时补 .js）
//	/vendor/golden-layout-css  <nm>/golden-layout/dist/css
//	/vendor/img                <nm>/golden-layout/dist/img
//
// 这些资源若不挂载，SPA 回退会把 index.html 当成模块返回，浏览器报
// "Expected a JavaScript-or-Wasm module script but the server responded
// with a MIME type of text/html" —— 页面将完全无法启动。
func (r *Router) Vendor(nodeModules string) {
	if st, err := os.Stat(nodeModules); err != nil || !st.IsDir() {
		return
	}
	type mount struct {
		prefix string
		dir    string
		addJS  bool
	}
	mounts := []mount{
		{"/vendor/three", filepath.Join(nodeModules, "three", "build"), false},
		{"/vendor/golden-layout", filepath.Join(nodeModules, "golden-layout", "dist", "esm"), true},
		{"/vendor/golden-layout-css", filepath.Join(nodeModules, "golden-layout", "dist", "css"), false},
		{"/vendor/img", filepath.Join(nodeModules, "golden-layout", "dist", "img"), false},
	}
	for _, m := range mounts {
		if st, err := os.Stat(m.dir); err != nil || !st.IsDir() {
			continue
		}
		m := m
		r.Get(m.prefix+"/*", func(w http.ResponseWriter, req *http.Request) {
			rel := strings.TrimPrefix(req.URL.Path, m.prefix+"/")
			if rel == "" || strings.Contains(rel, "..") {
				http.NotFound(w, req)
				return
			}
			target := filepath.Join(m.dir, filepath.FromSlash(rel))
			st, err := os.Stat(target)
			if err != nil || st.IsDir() {
				// golden-layout 的 import 省略 .js，Node 侧靠 extensions:['js'] 补齐
				if m.addJS && !strings.HasSuffix(rel, ".js") {
					withJS := target + ".js"
					if s2, e2 := os.Stat(withJS); e2 == nil && !s2.IsDir() {
						http.ServeFile(w, req, withJS)
						return
					}
				}
				http.NotFound(w, req)
				return
			}
			http.ServeFile(w, req, target)
		})
	}
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

	serve := func(w http.ResponseWriter, req *http.Request) bool {
		rel := strings.TrimPrefix(req.URL.Path, "/")
		if rel == "" {
			http.ServeFile(w, req, indexPath)
			return true
		}
		target := filepath.Join(dir, filepath.FromSlash(rel))
		if st, err := os.Stat(target); err == nil && !st.IsDir() {
			http.ServeFile(w, req, target)
			return true
		}
		return false
	}

	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		if serve(w, req) {
			return
		}
		// 请求的是具体资源（带扩展名）但文件不存在时，必须返回 404 而不是
		// index.html —— 否则浏览器会把 HTML 当模块/样式加载，报 MIME 错误，
		// 整页无法启动（例如 /vendor/* 未挂载时的表现）。
		if hasAssetExt(req.URL.Path) {
			http.NotFound(w, req)
			return
		}
		http.ServeFile(w, req, indexPath)
	})

	// /api 下的前端脚本（如 /api/api-client.js、/api/folder-tree.js）实际是
	// web/api/ 里的静态文件。Node 侧靠 express.static 在 /api 404 兜底之前
	// 命中它们；Go 侧 /api/* 是多个独立 mount，不匹配时会落到根 NotFound，
	// 因此在这里补一次「同名前缀」的静态查找，保持行为一致。
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		p := req.URL.Path
		if req.Method == http.MethodGet && strings.HasPrefix(p, "/api/") && strings.HasSuffix(p, ".js") {
			if serve(w, req) {
				return
			}
		}
		if strings.HasPrefix(p, "/api/") {
			Fail(w, CodeInvalidParam, "unknown API endpoint")
			return
		}
		http.NotFound(w, req)
	})
	return nil
}

// assetExts 是需要按「资源」而非「页面」对待的扩展名。
//
// 命中这些扩展名但文件不存在时必须返回 404：若回退到 index.html，浏览器
// 会把 HTML 当作 JS/CSS/图片解析，报 MIME 错误并导致整页无法启动。
var assetExts = map[string]struct{}{
	".js": {}, ".mjs": {}, ".css": {}, ".json": {}, ".map": {},
	".png": {}, ".jpg": {}, ".jpeg": {}, ".gif": {}, ".webp": {},
	".svg": {}, ".ico": {}, ".woff": {}, ".woff2": {}, ".ttf": {}, ".otf": {},
	".wasm": {}, ".hdr": {}, ".exr": {},
}

// hasAssetExt 判断路径是否以已知资源扩展名结尾。
func hasAssetExt(p string) bool {
	ext := strings.ToLower(filepath.Ext(p))
	_, ok := assetExts[ext]
	return ok
}
