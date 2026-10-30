// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/platform"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

const (
	hdriThumbW      = 480
	hdriThumbH      = 240
	hdriThumbVer    = 2
	hdriThumbMaxB64 = 10 * 1024 * 1024
)

// HDRI 管理 HDR 预设列表与缩略图缓存。
type HDRI struct {
	thumbDir string
	cfg      *store.Config

	mu         sync.Mutex
	cacheDir   string
	cacheMtime int64
	cacheVal   *HDRIList
}

// HDRIEntry 是单个 HDR 文件。
type HDRIEntry struct {
	Name     string  `json:"name"`
	FullPath string  `json:"fullPath"`
	Size     int64   `json:"size"`
	Mtime    float64 `json:"mtime"`
}

// HDRIList 是列表结果。
type HDRIList struct {
	Dir     string      `json:"dir"`
	Entries []HDRIEntry `json:"entries"`
}

// HDRIThumbInfo 是缩略图状态。
type HDRIThumbInfo struct {
	Exists   bool    `json:"exists"`
	Stale    bool    `json:"stale"`
	ThumbURL string  `json:"thumbUrl"`
	Mtime    float64 `json:"mtime"`
	Blurhash string  `json:"blurhash"`
}

type hdriMeta struct {
	Version  int     `json:"version"`
	Blurhash string  `json:"blurhash"`
	Mtime    float64 `json:"mtime"`
}

// NewHDRI 创建 HDR 服务。
func NewHDRI(paths platform.Paths, cfg *store.Config) *HDRI {
	return &HDRI{
		thumbDir: filepath.Join(paths.DataRoot, "data", "hdri-thumbs"),
		cfg:      cfg,
	}
}

// presetDir 读取配置里的 HDR 预设目录。
func (h *HDRI) presetDir() string {
	raw := h.cfg.Get()
	if v, ok := raw["hdriPresetPath"].(string); ok && v != "" {
		return v
	}
	return ""
}

// ThumbPathFor 按「归一化小写路径的 MD5」命名缩略图。
func (h *HDRI) ThumbPathFor(filePath string) string {
	key := strings.ToLower(filepath.Clean(filePath))
	sum := md5.Sum([]byte(key))
	return filepath.Join(h.thumbDir, hex.EncodeToString(sum[:])+".png")
}

func hdriThumbURL(fullPath string) string {
	return "/api/hdri/thumb?path=" + url.QueryEscape(fullPath)
}

// List 返回预设目录下的 .hdr/.exr 文件（按目录 mtime 缓存）。
func (h *HDRI) List() (*HDRIList, error) {
	dir := h.presetDir()
	info, err := os.Stat(dir)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "HDRI preset dir not readable: "+err.Error())
	}
	mtime := info.ModTime().UnixMilli()

	h.mu.Lock()
	if h.cacheVal != nil && h.cacheDir == dir && h.cacheMtime == mtime {
		cached := h.cacheVal
		h.mu.Unlock()
		return cached, nil
	}
	h.mu.Unlock()

	names, err := os.ReadDir(dir)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "HDRI preset dir not readable: "+err.Error())
	}
	entries := make([]HDRIEntry, 0, len(names))
	for _, de := range names {
		ext := strings.ToLower(filepath.Ext(de.Name()))
		if ext != ".hdr" && ext != ".exr" {
			continue
		}
		full := filepath.Join(dir, de.Name())
		st, statErr := os.Stat(full)
		if statErr != nil || st.IsDir() {
			continue
		}
		entries = append(entries, HDRIEntry{
			Name:     de.Name(),
			FullPath: full,
			Size:     st.Size(),
			Mtime:    float64(st.ModTime().UnixMilli()),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })

	result := &HDRIList{Dir: dir, Entries: entries}
	h.mu.Lock()
	h.cacheDir, h.cacheMtime, h.cacheVal = dir, mtime, result
	h.mu.Unlock()
	return result, nil
}

// InvalidateList 使列表缓存失效；dir 为空则全部失效。
func (h *HDRI) InvalidateList(dir string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if dir == "" || h.cacheDir == dir {
		h.cacheDir, h.cacheMtime, h.cacheVal = "", 0, nil
	}
}

// ThumbInfo 返回缩略图状态。
func (h *HDRI) ThumbInfo(fullPath string) (HDRIThumbInfo, error) {
	thumbPath := h.ThumbPathFor(fullPath)
	metaPath := thumbPath + ".json"
	srcStat, err := os.Stat(fullPath)
	if err != nil {
		return HDRIThumbInfo{}, err
	}
	info := HDRIThumbInfo{Stale: true, ThumbURL: hdriThumbURL(fullPath)}
	if tStat, err := os.Stat(thumbPath); err == nil {
		info.Exists = true
		info.Mtime = float64(tStat.ModTime().UnixMilli())
		info.Stale = tStat.ModTime().Before(srcStat.ModTime())
	}
	if info.Exists && !info.Stale {
		if raw, err := os.ReadFile(metaPath); err == nil {
			var meta hdriMeta
			if json.Unmarshal(raw, &meta) == nil {
				if meta.Version == hdriThumbVer {
					info.Blurhash = meta.Blurhash
				} else {
					info.Stale = true
				}
			}
		}
	}
	return info, nil
}

// SaveThumb 保存前端生成的缩略图。
func (h *HDRI) SaveThumb(fullPath, dataURL string) (map[string]any, error) {
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid thumb data")
	}
	b64 := dataURL[comma+1:]
	if b64 == "" || len(b64) > hdriThumbMaxB64 {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid thumb data")
	}
	buf, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid base64 data")
	}
	if err := os.MkdirAll(h.thumbDir, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	if err := os.WriteFile(h.ThumbPathFor(fullPath), buf, 0o644); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	return map[string]any{"success": true, "thumbUrl": hdriThumbURL(fullPath)}, nil
}

// EnsureThumb 确保缩略图存在且新鲜，返回其路径。
func (h *HDRI) EnsureThumb(fullPath string) (string, error) {
	thumbPath := h.ThumbPathFor(fullPath)
	metaPath := thumbPath + ".json"
	srcStat, err := os.Stat(fullPath)
	if err != nil {
		return "", httpx.Errorf(httpx.CodeFSNotFound, err.Error())
	}

	needGen := true
	if tStat, err := os.Stat(thumbPath); err == nil && !tStat.ModTime().Before(srcStat.ModTime()) {
		if raw, err := os.ReadFile(metaPath); err == nil {
			var meta hdriMeta
			if json.Unmarshal(raw, &meta) == nil && meta.Version == hdriThumbVer {
				needGen = false
			}
		}
	}
	if !needGen {
		return thumbPath, nil
	}

	buf, err := os.ReadFile(fullPath)
	if err != nil {
		return "", httpx.Errorf(httpx.CodeFS, err.Error())
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(fullPath)), ".")
	result, err := GenerateThumb(buf, ext, hdriThumbW, hdriThumbH)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(h.thumbDir, 0o755); err != nil {
		return "", httpx.Errorf(httpx.CodeFS, err.Error())
	}
	if err := os.WriteFile(thumbPath, result.PNG, 0o644); err != nil {
		return "", httpx.Errorf(httpx.CodeFS, err.Error())
	}
	meta, _ := json.Marshal(hdriMeta{
		Version:  hdriThumbVer,
		Blurhash: result.Blurhash,
		Mtime:    float64(srcStat.ModTime().UnixMilli()),
	})
	if err := os.WriteFile(metaPath, meta, 0o644); err != nil {
		return "", httpx.Errorf(httpx.CodeFS, err.Error())
	}
	return thumbPath, nil
}

// CleanupOrphans 删除已无对应 HDR 文件的缩略图。
func (h *HDRI) CleanupOrphans() (map[string]any, error) {
	dir := h.presetDir()
	valid := make(map[string]bool)
	if names, err := os.ReadDir(dir); err == nil {
		for _, de := range names {
			ext := strings.ToLower(filepath.Ext(de.Name()))
			if ext == ".hdr" || ext == ".exr" {
				valid[filepath.Base(h.ThumbPathFor(filepath.Join(dir, de.Name())))] = true
			}
		}
	}
	removed := 0
	if files, err := os.ReadDir(h.thumbDir); err == nil {
		for _, f := range files {
			base := f.Name()
			if strings.HasSuffix(base, ".json") {
				base = strings.TrimSuffix(base, ".json")
			}
			if !valid[base] {
				_ = os.Remove(filepath.Join(h.thumbDir, f.Name()))
				removed++
			}
		}
	}
	return map[string]any{"removed": removed, "valid": len(valid)}, nil
}
