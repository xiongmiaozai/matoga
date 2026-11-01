// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package httpx

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

// Auth 实现 LAN 令牌鉴权，对齐 Node 版 server/middleware/auth.js：
//   - 未初始化令牌（本地模式）→ 全部放行
//   - 已初始化（LAN 模式）→ 需 query `token` 或 header `x-matoga-token`
type Auth struct {
	token string
}

// NewAuth 创建鉴权中间件；token 为空表示本地模式。
func NewAuth(token string) *Auth { return &Auth{token: token} }

// Mode 返回 "lan" 或 "local"。
func (a *Auth) Mode() string {
	if a.token != "" {
		return "lan"
	}
	return "local"
}

// Token 返回当前令牌。
func (a *Auth) Token() string { return a.token }

// Middleware 对 /api/* 做令牌校验。
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.token == "" || !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		t := r.URL.Query().Get("token")
		if t == "" {
			t = r.Header.Get("x-matoga-token")
		}
		if t == a.token {
			next.ServeHTTP(w, r)
			return
		}
		Fail(w, CodeUnauthorized, "invalid token")
	})
}

// RequireLocal 拒绝 LAN 模式下调用本地专用接口（shell 等）。
func (a *Auth) RequireLocal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.token != "" {
			Fail(w, CodeLanForbidden, "shell API is disabled in LAN mode")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequestLogger 记录每个请求的方法、路径、状态与耗时。
func RequestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Hijack 把连接劫持透传给底层 ResponseWriter。
//
// WebSocket 升级必须劫持原始 TCP 连接。若不实现此方法，coder/websocket
// 检测不到 http.Hijacker 就会返回 501 Not Implemented —— 这是包装
// ResponseWriter 的中间件最常见的坑。
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return h.Hijack()
}

// Flush 透传给底层，保证流式响应不被缓冲层卡住。
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Recover 捕获 panic，返回 ERR_UNKNOWN，避免进程退出。
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic", "path", r.URL.Path, "err", rec)
					Fail(w, CodeUnknown, "internal error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
