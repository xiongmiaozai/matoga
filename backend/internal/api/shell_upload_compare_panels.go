// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/upload"
)

// MaxUploadBytes 是单个上传文件的上限（128MB）。
const MaxUploadBytes = 128 * 1024 * 1024

// ShellHandler 提供 /api/shell 的本地文件管理器集成。
//
// 与 Node 版一致：仅本地模式可用，LAN 模式下由 RequireLocal 拦截。
type ShellHandler struct{}

// Open 用系统默认程序打开路径。
func (h *ShellHandler) Open(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	if err := openPath(p); err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// Reveal 在文件管理器中定位路径。
func (h *ShellHandler) Reveal(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	if err := revealInFolder(p); err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// openPath 用系统默认程序打开路径。
func openPath(p string) error {
	switch runtime.GOOS {
	case "windows":
		return startDetached("cmd", "/c", "start", "", p)
	case "darwin":
		return startDetached("open", p)
	default:
		return startDetached("xdg-open", p)
	}
}

// revealInFolder 在文件管理器中定位。
func revealInFolder(p string) error {
	switch runtime.GOOS {
	case "windows":
		return startDetached("explorer", "/select,", p)
	case "darwin":
		return startDetached("open", "-R", p)
	default:
		return startDetached("xdg-open", dirOf(p))
	}
}

// startDetached 启动一个分离的子进程，不等待其结束。
func startDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	// 主动释放，避免僵尸进程
	return cmd.Process.Release()
}

// UploadHandler 提供 /api/upload 的分块上传。
type UploadHandler struct {
	Service *upload.Service
}

// Begin 开始上传会话。
func (h *UploadHandler) Begin(w http.ResponseWriter, r *http.Request) error {
	res, err := h.Service.Begin()
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// PutFile 上传单个文件（请求体为原始字节）。
func (h *UploadHandler) PutFile(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	data, err := io.ReadAll(io.LimitReader(r.Body, MaxUploadBytes+1))
	if err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "读取请求体失败: "+err.Error())
	}
	if len(data) > MaxUploadBytes {
		return httpx.Errorf(httpx.CodeInvalidParam, "file too large (max 128MB)")
	}
	res, err := h.Service.PutFile(q.Get("uploadId"), q.Get("path"), data)
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// End 结束上传会话。
func (h *UploadHandler) End(w http.ResponseWriter, r *http.Request) error {
	res, err := h.Service.End(r.URL.Query().Get("uploadId"))
	if err != nil {
		return err
	}
	httpx.OK(w, res)
	return nil
}

// CompareHandler 提供 /api/compare 的目录扫描。
type CompareHandler struct{}

// Scan 扫描目录并返回条目列表。
func (h *CompareHandler) Scan(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Path      string   `json:"path"`
		Recursive bool     `json:"recursive"`
		Ignore    []string `json:"ignore"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	entries, err := fsx.Scan(p, body.Ignore, body.Recursive)
	if err != nil {
		return err
	}
	// 扫描后把该目录加入可信写入根（与 Node 版 trust(n) 一致）
	fsx.Trust(p)
	httpx.OK(w, map[string]any{"entries": entries})
	return nil
}

// PanelsHandler 提供 /api/panels 的面板清单。
type PanelsHandler struct {
	// Dir 是 web/src/panels 目录。
	Dir string
}

// panelManifest 是 manifest.json 的原始内容。
type panelManifest struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Icon    string   `json:"icon"`
	HTML    string   `json:"html"`
	JS      string   `json:"js"`
	CSS     string   `json:"css"`
	Mount   string   `json:"mount"`
	Order   *float64 `json:"order"`
	Dynamic bool     `json:"dynamic"`
	Deps    []string `json:"deps"`
}

// panelEntry 是返回给前端的面板描述。
type panelEntry struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Icon    string   `json:"icon"`
	HTMLURL *string  `json:"htmlUrl"`
	JSURL   *string  `json:"jsUrl"`
	CSSURL  *string  `json:"cssUrl"`
	Mount   string   `json:"mount"`
	Order   float64  `json:"order"`
	Dynamic bool     `json:"dynamic"`
	Deps    []string `json:"deps"`
}

// List 扫描 panels 目录下的 manifest.json，返回可用面板清单。
//
// 与 Node 版一致：响应体为 {ok, panels} 而不是 {ok, data}。
func (h *PanelsHandler) List(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"panels": h.scanPanels(),
	})
	return nil
}

// scanPanels 遍历 panels 目录，跳过无 manifest 或损坏的条目。
func (h *PanelsHandler) scanPanels() []panelEntry {
	out := make([]panelEntry, 0, 8)
	ents, err := os.ReadDir(h.Dir)
	if err != nil {
		return out
	}
	for _, ent := range ents {
		if !ent.IsDir() {
			continue
		}
		mfPath := filepath.Join(h.Dir, ent.Name(), "manifest.json")
		raw, err := os.ReadFile(mfPath)
		if err != nil {
			continue
		}
		var mf panelManifest
		if err := json.Unmarshal(raw, &mf); err != nil {
			continue
		}
		base := "/src/panels/" + ent.Name()
		e := panelEntry{
			ID:      firstNonEmpty(mf.ID, ent.Name()),
			Title:   firstNonEmpty(mf.Title, ent.Name()),
			Icon:    mf.Icon,
			Mount:   firstNonEmpty(mf.Mount, "body"),
			Order:   999,
			Dynamic: mf.Dynamic,
			Deps:    mf.Deps,
		}
		if mf.Order != nil {
			e.Order = *mf.Order
		}
		if e.Deps == nil {
			e.Deps = []string{}
		}
		if mf.HTML != "" {
			u := base + "/" + mf.HTML
			e.HTMLURL = &u
		}
		if mf.JS != "" {
			u := base + "/" + mf.JS
			e.JSURL = &u
		}
		if mf.CSS != "" {
			u := base + "/" + mf.CSS
			e.CSSURL = &u
		}
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// dirOf 返回路径所在目录（避免依赖 path/filepath 的额外导入）。
func dirOf(p string) string {
	return filepath.Dir(p)
}
