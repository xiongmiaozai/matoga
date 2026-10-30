// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/api"
	"github.com/xiongmiaozai/matoga/backend/internal/craftpack"
	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/lang"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/platform"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
	"github.com/xiongmiaozai/matoga/backend/internal/syncjob"
	"github.com/xiongmiaozai/matoga/backend/internal/theme"
	"github.com/xiongmiaozai/matoga/backend/internal/upload"
)

var version = "dev"

func main() {
	var (
		port     = flag.Int("port", 5123, "监听端口")
		lan      = flag.Bool("lan", false, "以 LAN 模式启动（需要令牌）")
		dataRoot = flag.String("data-root", "", "数据根目录（覆盖 MATOGA_DATA_ROOT）")
		webDir   = flag.String("web", "", "前端静态目录（默认 <资源根>/web）")
	)
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	if *dataRoot != "" {
		_ = os.Setenv("MATOGA_DATA_ROOT", *dataRoot)
	}
	paths, err := platform.ResolvePaths()
	if err != nil {
		log.Error("解析路径失败", "err", err.Error())
		os.Exit(1)
	}
	log.Info("启动", "version", version, "dataRoot", paths.DataRoot)

	// 可信写入根：数据目录与预设目录。
	fsx.Trust(paths.DataRoot)
	fsx.Trust(paths.PresetRoot)

	token := ""
	if *lan {
		buf := make([]byte, 16)
		if _, err := rand.Read(buf); err != nil {
			log.Error("生成令牌失败", "err", err.Error())
			os.Exit(1)
		}
		token = hex.EncodeToString(buf)
	}
	auth := httpx.NewAuth(token)

	cfg := store.NewConfig(paths, log)
	assetStore := store.NewAssetStore(paths.DataRoot, log)
	r := httpx.NewRouter(auth, log)

	api.Mount(r, api.Services{
		Deps:           &api.Deps{StartedAt: time.Now(), Auth: auth, Version: version},
		Config:         cfg,
		Thumbs:         media.NewThumb(paths),
		HDRI:           media.NewHDRI(paths, cfg),
		Assets:         assetStore,
		ModelThumbs:    media.NewModelThumb(paths.DataRoot),
		Upload:         upload.New(paths.DataRoot),
		PanelsDir:      filepath.Join(paths.ResRoot, "web", "src", "panels"),
		Workspaces:     store.NewWorkspaceStore(filepath.Join(paths.DataRoot, "data"), log),
		NodeProjects:   store.NewNodeProjectStore(filepath.Join(paths.DataRoot, "data"), log),
		ImportedModels: store.NewImportedModelStore(filepath.Join(paths.DataRoot, "data")),
		CustomModels:   store.NewCustomModelStore(paths.DataRoot),
		CraftPack:      craftpack.New(paths.DataRoot, assetStore, cfg),
		Lang:           lang.New(filepath.Join(paths.ResRoot, "server", "assets", "zh_cn.json")),
		Themes:         theme.NewStore(filepath.Join(paths.DataRoot, "data", "themes")),
		SyncJobs:       syncjob.NewRunner(),
		// 三个包路由的根目录：每次请求都读最新配置，支持运行时改路径。
		CraftPacksRoot: func() string { return cfgPath(cfg, "craftPacksPath") },
		McPacksRoot:    func() string { return cfgPath(cfg, "mcPacksPath") },
		McOfficialRoot: func() string { return cfgPath(cfg, "officialPacksPath") },
	})

	// 静态前端
	web := *webDir
	if web == "" {
		web = filepath.Join(paths.ResRoot, "web")
	}
	// 第三方前端依赖（three / golden-layout）必须挂载，否则 SPA 回退会把
	// index.html 当模块返回，页面因 MIME 错误无法启动。
	r.Vendor(filepath.Join(paths.ResRoot, "node_modules"))

	if err := r.Static(web); err != nil {
		log.Warn("静态目录挂载失败", "dir", web, "err", err.Error())
	}

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	if *lan {
		addr = fmt.Sprintf("0.0.0.0:%d", *port)
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 先显式 bind 再宣布就绪：ListenAndServe 内部的 Listen 与就绪日志之间
	// 存在竞态，客户端/Electron 可能在端口真正监听前就开始连接。
	// 显式 net.Listen 拿到 listener 后，端口一定已就绪。
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Error("端口监听失败", "addr", addr, "err", err.Error())
		os.Exit(1)
	}

	go func() {
		log.Info("HTTP 服务就绪", "addr", addr, "mode", auth.Mode())
		// Electron 主进程靠这一行判断服务可连接（与 Node 版 server/index.js 对齐）。
		fmt.Printf("MATOGA_LISTENING:%d\n", *port)
		if token != "" {
			fmt.Printf("\n  LAN 访问地址: http://<本机IP>:%d/?token=%s\n\n", *port, token)
		}
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("服务异常退出", "err", err.Error())
			os.Exit(1)
		}
	}()

	// 优雅关闭
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Info("收到退出信号，开始关闭")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("关闭超时", "err", err.Error())
	}
	log.Info("已退出")
}

// cfgPath 从配置快照取字符串路径，缺失回落空串。
func cfgPath(cfg *store.Config, key string) string {
	if v, ok := cfg.Get()[key].(string); ok {
		return v
	}
	return ""
}
