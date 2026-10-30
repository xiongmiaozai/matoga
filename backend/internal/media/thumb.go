// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package media 处理缩略图、HDR 与模型预览等媒体相关逻辑。
package media

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/platform"
)

// Thumb 管理贴图缩略图缓存（前端 canvas 生成后回传 base64，后端只存盘）。
type Thumb struct {
	dir string
}

// NewThumb 创建缩略图服务。
func NewThumb(paths platform.Paths) *Thumb {
	return &Thumb{dir: filepath.Join(paths.DataRoot, "data", "thumbs")}
}

// Dir 返回缩略图目录。
func (t *Thumb) Dir() string { return t.dir }

// PathFor 按「归一化小写路径的 MD5」决定缩略图文件名。
func (t *Thumb) PathFor(filePath string) string {
	key := strings.ToLower(filepath.Clean(filePath))
	sum := md5.Sum([]byte(key))
	return filepath.Join(t.dir, hex.EncodeToString(sum[:])+".jpg")
}

// Info 是缩略图状态。
type Info struct {
	Exists   bool    `json:"exists"`
	Stale    bool    `json:"stale"`
	ThumbURL string  `json:"thumbUrl"`
	Mtime    float64 `json:"mtime"`
}

// Info 返回缩略图状态（是否存在、是否过期）。
func (t *Thumb) Info(fullPath string) (Info, error) {
	srcInfo, err := os.Stat(fullPath)
	if err != nil {
		return Info{}, err
	}
	info := Info{
		Stale:    true,
		ThumbURL: "/api/file/thumb?path=" + url.QueryEscape(fullPath),
	}
	if st, err := os.Stat(t.PathFor(fullPath)); err == nil {
		info.Exists = true
		info.Mtime = float64(st.ModTime().UnixMilli())
		info.Stale = st.ModTime().Before(srcInfo.ModTime())
	}
	return info, nil
}

// SaveResult 是保存缩略图的结果。
type SaveResult struct {
	Success  bool   `json:"success"`
	ThumbURL string `json:"thumbUrl,omitempty"`
	Error    string `json:"error,omitempty"`
}

// Save 保存 dataUrl 形式的缩略图。
func (t *Thumb) Save(fullPath, dataURL string) SaveResult {
	if err := os.MkdirAll(t.dir, 0o755); err != nil {
		return SaveResult{Success: false, Error: err.Error()}
	}
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return SaveResult{Success: false, Error: "invalid thumb data"}
	}
	b64 := dataURL[comma+1:]
	if b64 == "" || len(b64) > 10*1024*1024 {
		return SaveResult{Success: false, Error: "invalid thumb data"}
	}
	buf, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return SaveResult{Success: false, Error: "invalid base64 data"}
	}
	if err := os.WriteFile(t.PathFor(fullPath), buf, 0o644); err != nil {
		return SaveResult{Success: false, Error: err.Error()}
	}
	return SaveResult{
		Success:  true,
		ThumbURL: "/api/file/thumb?path=" + url.QueryEscape(fullPath),
	}
}

// Invalidate 删除某路径的缩略图缓存。
func (t *Thumb) Invalidate(fullPath string) {
	if fullPath == "" {
		return
	}
	_ = os.Remove(t.PathFor(fullPath))
}
