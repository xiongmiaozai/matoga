// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
)

// FileHandler 提供 /api/file 的读写、复制、备份、哈希与缩略图。
type FileHandler struct {
	Thumbs *media.Thumb
}

type pathBody struct {
	Path string `json:"path"`
}

type copyBody struct {
	Src  string `json:"src"`
	Dest string `json:"dest"`
}

type writeBody struct {
	Path    string `json:"path"`
	DataURL string `json:"dataUrl"`
}

// Hash 计算文件 MD5。
func (h *FileHandler) Hash(w http.ResponseWriter, r *http.Request) error {
	var body pathBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardRead(body.Path)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"hash": fsx.HashFile(p)})
	return nil
}

// Copy 复制文件到目标（目标须在可信根内）。
func (h *FileHandler) Copy(w http.ResponseWriter, r *http.Request) error {
	var body copyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	src, err := fsx.GuardRead(body.Src)
	if err != nil {
		return err
	}
	dest, err := fsx.GuardWrite(body.Dest)
	if err != nil {
		return err
	}
	res := fsx.CopyFile(src, dest)
	fsx.InvalidateHash(dest)
	httpx.OK(w, res)
	return nil
}

// Backup 在源文件旁生成备份。
func (h *FileHandler) Backup(w http.ResponseWriter, r *http.Request) error {
	var body pathBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardWrite(body.Path)
	if err != nil {
		return err
	}
	httpx.OK(w, fsx.BackupFile(p))
	return nil
}

// Delete 删除文件。
func (h *FileHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	var body pathBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardWrite(body.Path)
	if err != nil {
		return err
	}
	res := fsx.DeleteFile(p)
	fsx.InvalidateHash(p)
	httpx.OK(w, res)
	return nil
}

// Raw 直接发送文件字节。
func (h *FileHandler) Raw(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	info, statErr := os.Stat(p)
	if statErr != nil || info.IsDir() {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		httpx.Fail(w, httpx.CodeFSNotFound, "file not found")
		return nil
	}
	http.ServeFile(w, r, p)
	return nil
}

// ThumbInfo 返回缩略图状态。
func (h *FileHandler) ThumbInfo(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	info, err := h.Thumbs.Info(p)
	if err != nil {
		httpx.Fail(w, httpx.CodeFSNotFound, err.Error())
		return nil
	}
	httpx.OK(w, info)
	return nil
}

// Thumb 发送缩略图；未生成时返回 ERR_FS_NOT_FOUND。
func (h *FileHandler) Thumb(w http.ResponseWriter, r *http.Request) error {
	p, err := fsx.GuardRead(r.URL.Query().Get("path"))
	if err != nil {
		return err
	}
	info, err := h.Thumbs.Info(p)
	if err != nil {
		httpx.Fail(w, httpx.CodeFSNotFound, err.Error())
		return nil
	}
	if !info.Exists {
		httpx.Fail(w, httpx.CodeFSNotFound, "thumbnail not generated yet")
		return nil
	}
	http.ServeFile(w, r, h.Thumbs.PathFor(p))
	return nil
}

// SaveThumb 接收前端生成的缩略图。
func (h *FileHandler) SaveThumb(w http.ResponseWriter, r *http.Request) error {
	var body writeBody
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
	httpx.OK(w, h.Thumbs.Save(p, body.DataURL))
	return nil
}

// Write 把 dataUrl 图片写到指定路径。
func (h *FileHandler) Write(w http.ResponseWriter, r *http.Request) error {
	var body writeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid json")
	}
	p, err := fsx.GuardWrite(body.Path)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(body.DataURL, "data:image/") {
		httpx.Fail(w, httpx.CodeInvalidParam, "invalid dataUrl")
		return nil
	}
	comma := strings.Index(body.DataURL, ",")
	if comma < 0 {
		httpx.Fail(w, httpx.CodeInvalidParam, "empty image data")
		return nil
	}
	buf, decErr := base64.StdEncoding.DecodeString(body.DataURL[comma+1:])
	if decErr != nil {
		httpx.Fail(w, httpx.CodeInvalidParam, "invalid base64 data")
		return nil
	}
	if len(buf) == 0 {
		httpx.Fail(w, httpx.CodeInvalidParam, "empty image data")
		return nil
	}
	if err := fsx.WriteFileBytes(p, buf); err != nil {
		return err
	}
	fsx.InvalidateHash(p)
	httpx.OK(w, map[string]any{"path": p, "size": len(buf)})
	return nil
}
