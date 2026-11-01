// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package api 实现全部 HTTP 接口。
package api

import (
	"net/http"
	"runtime"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// Deps 汇总各接口共享的依赖。
type Deps struct {
	StartedAt time.Time
	Auth      *httpx.Auth
	Version   string
}

// Health 返回运行状态。字段名保持与 Node 版一致（node 填运行时版本）。
func (d *Deps) Health(w http.ResponseWriter, r *http.Request) error {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	httpx.OK(w, map[string]any{
		"status":  "ok",
		"uptime":  time.Since(d.StartedAt).Seconds(),
		"pid":     0,
		"node":    runtime.Version(),
		"runtime": "go",
		"lan":     d.Auth.Mode() == "lan",
		"memory": map[string]any{
			"rss":       ms.Sys,
			"heapUsed":  ms.HeapInuse,
			"heapTotal": ms.HeapSys,
		},
		"ts": time.Now().UnixMilli(),
	})
	return nil
}
