// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// 模型缩略图缓存参数，与 Node 版 model-thumb-service.js 对齐。
const (
	// ModelThumbMaxDataURL 是单帧 base64 的长度上限（5MB）。
	ModelThumbMaxDataURL = 5 * 1024 * 1024
	// ModelThumbMaxFrames 是动画模型的最大帧数。
	ModelThumbMaxFrames = 8
	// ModelThumbRendererVersion 是渲染器版本；前端算法升级后递增，旧缓存即使 mtime 不变也判 stale。
	ModelThumbRendererVersion = 5
)

// ModelThumb 管理模型缩略图缓存。
//
// 模型资产是虚拟路径（packmodel:/bb:/im:/cm:），没有磁盘文件可 stat，
// 因此缓存键 = md5(虚拟路径)，staleness 用前端传入的源 mtime 与 sidecar 中记录的 mtime 对比。
type ModelThumb struct {
	base string
	mu   sync.Mutex
}

// ModelThumbInfo 是缓存查询结果。
type ModelThumbInfo struct {
	Exists      bool    `json:"exists"`
	Stale       bool    `json:"stale"`
	CachedMtime float64 `json:"cachedMtime"`
	Renderer    int     `json:"renderer"`
	FrameCount  int     `json:"frameCount"`
	FrameDelay  int     `json:"frameDelay"`
	ThumbURL    string  `json:"thumbUrl"`
}

// modelThumbMeta 是 sidecar 内容。
type modelThumbMeta struct {
	Mtime      float64 `json:"mtime"`
	Renderer   int     `json:"renderer"`
	FrameCount int     `json:"frameCount"`
	FrameDelay int     `json:"frameDelay"`
}

// NewModelThumb 创建模型缩略图服务；base 为 data/model-thumbs 的父级数据目录。
func NewModelThumb(dataRoot string) *ModelThumb {
	return &ModelThumb{base: filepath.Join(dataRoot, "data", "model-thumbs")}
}

// ModelThumbKindFor 按 key 前缀判定缓存子目录名。
func ModelThumbKindFor(key string) string {
	switch {
	case strings.HasPrefix(key, "im:"):
		return "imported"
	case strings.HasPrefix(key, "cm:"):
		return "custom"
	case strings.HasPrefix(key, "packmodel:"):
		return "mc"
	default:
		return "misc"
	}
}

// dirFor 返回 key 对应的缓存目录（misc 直接落 base）。
func (m *ModelThumb) dirFor(key string) string {
	kind := ModelThumbKindFor(key)
	if kind == "misc" {
		return m.base
	}
	return filepath.Join(m.base, kind)
}

// hashFor 返回 md5(key) 的十六进制串。
func hashFor(key string) string {
	sum := md5.Sum([]byte(key))
	return hex.EncodeToString(sum[:])
}

// pngPathFor 返回某帧的 PNG 路径；frame>0 时带 .f<i> 后缀，帧 0 保持单帧路径兼容。
func (m *ModelThumb) pngPathFor(key string, frame int) string {
	h := hashFor(key)
	if frame > 0 {
		return filepath.Join(m.dirFor(key), fmt.Sprintf("%s.f%d.png", h, frame))
	}
	return filepath.Join(m.dirFor(key), h+".png")
}

// metaPathFor 返回 sidecar 路径。
func (m *ModelThumb) metaPathFor(key string) string {
	return filepath.Join(m.dirFor(key), hashFor(key)+".json")
}

// thumbURL 生成前端取图地址。
func thumbURL(key string) string {
	return "/api/asset/model-thumb?key=" + urlEncode(key)
}

// urlEncode 对 key 做百分号转义（与 encodeURIComponent 等价的安全子集）。
func urlEncode(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hexDigits[c>>4])
		b.WriteByte(hexDigits[c&0x0f])
	}
	return b.String()
}

// ParseFrameParam 解析 frame 查询参数；越界或非法一律回落到 0。
func ParseFrameParam(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 || n >= ModelThumbMaxFrames {
		return 0
	}
	return n
}

// Info 查询缓存状态。
//
// exists 要求 PNG 与 sidecar 同时存在（多帧以帧 0 为准）；
// stale 表示缓存 mtime 早于当前源 mtime，或渲染器版本落后。
func (m *ModelThumb) Info(key string, mtime float64) ModelThumbInfo {
	out := ModelThumbInfo{
		Exists:     false,
		Stale:      true,
		Renderer:   ModelThumbRendererVersion,
		FrameCount: 1,
		FrameDelay: 0,
		ThumbURL:   thumbURL(key),
	}
	raw, err := os.ReadFile(m.metaPathFor(key))
	if err != nil {
		return out
	}
	var meta modelThumbMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return out
	}
	if _, err := os.Stat(m.pngPathFor(key, 0)); err != nil {
		return out
	}
	out.Exists = true
	out.CachedMtime = meta.Mtime
	outdated := meta.Renderer <= 0 || meta.Renderer < ModelThumbRendererVersion
	out.Stale = outdated || meta.Mtime < mtime
	if meta.FrameCount > 1 {
		fc := meta.FrameCount
		if fc > ModelThumbMaxFrames {
			fc = ModelThumbMaxFrames
		}
		out.FrameCount = fc
	}
	if meta.FrameDelay > 0 {
		out.FrameDelay = meta.FrameDelay
	}
	return out
}

// SaveFrame 是单帧写入参数。
type SaveFrame struct {
	DataURL string `json:"dataUrl"`
	Delay   int    `json:"delay"`
}

// SavePayload 是保存请求体：单帧用 dataUrl，多帧用 frames。
type SavePayload struct {
	DataURL string      `json:"dataUrl"`
	Frames  []SaveFrame `json:"frames"`
}

// ModelThumbSaveResult 是保存结果。
type ModelThumbSaveResult struct {
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
	ThumbURL   string `json:"thumbUrl,omitempty"`
	FrameCount int    `json:"frameCount,omitempty"`
	FrameDelay int    `json:"frameDelay,omitempty"`
}

// Save 保存缩略图：单帧写 <md5>.png，帧 i≥1 写 <md5>.f<i>.png。
//
// 帧数少于旧缓存时清除多余旧帧文件。
func (m *ModelThumb) Save(key string, mtime float64, p SavePayload) ModelThumbSaveResult {
	frames := p.Frames
	if len(frames) == 0 {
		frames = []SaveFrame{{DataURL: p.DataURL, Delay: 0}}
	}
	if len(frames) > ModelThumbMaxFrames {
		frames = frames[:ModelThumbMaxFrames]
	}

	// 先全部校验，避免写一半才失败
	decoded := make([][]byte, 0, len(frames))
	for _, f := range frames {
		if !strings.HasPrefix(f.DataURL, "data:image/") {
			return ModelThumbSaveResult{Success: false, Error: "invalid dataUrl"}
		}
		comma := strings.IndexByte(f.DataURL, ',')
		if comma < 0 {
			return ModelThumbSaveResult{Success: false, Error: "invalid dataUrl"}
		}
		b64 := f.DataURL[comma+1:]
		if b64 == "" || len(b64) > ModelThumbMaxDataURL {
			return ModelThumbSaveResult{Success: false, Error: "invalid thumb data"}
		}
		bin, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return ModelThumbSaveResult{Success: false, Error: "invalid thumb data"}
		}
		decoded = append(decoded, bin)
	}

	frameDelay := frames[0].Delay
	if frameDelay < 0 {
		frameDelay = 0
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	dir := m.dirFor(key)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ModelThumbSaveResult{Success: false, Error: err.Error()}
	}

	// 帧数减少时清除多余旧帧
	if raw, err := os.ReadFile(m.metaPathFor(key)); err == nil {
		var old modelThumbMeta
		if json.Unmarshal(raw, &old) == nil {
			oldCount := old.FrameCount
			if oldCount < 1 {
				oldCount = 1
			}
			if oldCount > ModelThumbMaxFrames {
				oldCount = ModelThumbMaxFrames
			}
			for i := oldCount - 1; i >= len(decoded); i-- {
				if i > 0 {
					_ = os.Remove(m.pngPathFor(key, i))
				}
			}
		}
	}

	for i, bin := range decoded {
		if err := os.WriteFile(m.pngPathFor(key, i), bin, 0o644); err != nil {
			return ModelThumbSaveResult{Success: false, Error: err.Error()}
		}
	}

	meta := modelThumbMeta{
		Mtime:      mtime,
		Renderer:   ModelThumbRendererVersion,
		FrameCount: len(decoded),
		FrameDelay: frameDelay,
	}
	buf, err := json.Marshal(meta)
	if err != nil {
		return ModelThumbSaveResult{Success: false, Error: err.Error()}
	}
	if err := os.WriteFile(m.metaPathFor(key), buf, 0o644); err != nil {
		return ModelThumbSaveResult{Success: false, Error: err.Error()}
	}

	return ModelThumbSaveResult{
		Success:    true,
		ThumbURL:   thumbURL(key),
		FrameCount: len(decoded),
		FrameDelay: frameDelay,
	}
}

// Path 返回某帧 PNG 的绝对路径（供 HTTP 层直接发送文件）。
func (m *ModelThumb) Path(key string, frame int) string {
	return m.pngPathFor(key, frame)
}

// Invalidate 清除某 key 的全部缓存帧与 sidecar。
func (m *ModelThumb) Invalidate(key string) {
	if key == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := 0; i < ModelThumbMaxFrames; i++ {
		_ = os.Remove(m.pngPathFor(key, i))
	}
	_ = os.Remove(m.metaPathFor(key))
}
