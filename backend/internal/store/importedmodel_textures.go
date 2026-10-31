// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// textureRootPrefix 是贴图在模型目录内的固定前缀，与资源包结构保持一致。
const textureRootPrefix = "assets"

// textureExts 是允许的贴图扩展名。
var textureExts = map[string]struct{}{
	"png": {}, "jpg": {}, "jpeg": {}, "webp": {}, "gif": {},
	"bmp": {}, "tiff": {}, "tif": {}, "avif": {},
}

// maxTextureBytes 是单张贴图上限（8 MiB）。超过则拒绝，避免误传大文件撑爆磁盘。
const maxTextureBytes = 8 << 20

// ImportedTexture 是贴图列表项。
type ImportedTexture struct {
	Path  string  `json:"path"`
	Size  int64   `json:"size"`
	Mtime float64 `json:"mtime"`
}

// ImportedTextureSaved 是单张保存结果。
type ImportedTextureSaved struct {
	Path string `json:"path"`
	Size int    `json:"size"`
}

// assertValidTextureRel 校验贴图相对路径。
//
// 规则（与 Node 侧一致，且更严格）：
//   - 必须以 assets/ 开头
//   - 不得包含 .. 或绝对路径（防路径穿越）
//   - 扩展名必须在白名单内
func assertValidTextureRel(rel string) (string, error) {
	if rel == "" {
		return "", fmt.Errorf("invalid texture path")
	}
	norm := strings.ReplaceAll(rel, `\`, "/")
	if strings.HasPrefix(norm, "..") || strings.Contains(norm, "../") || strings.HasPrefix(norm, "/") {
		return "", fmt.Errorf("invalid texture path")
	}
	if !strings.HasPrefix(norm, textureRootPrefix+"/") {
		return "", fmt.Errorf("texture path must start with %s/", textureRootPrefix)
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(norm), "."))
	if _, ok := textureExts[ext]; !ok {
		return "", fmt.Errorf("unsupported texture extension: %s", ext)
	}
	return norm, nil
}

// decodeDataURL 复用 nodeproject.go 中的实现（带 maxBytes 上限），
// 此处不重复定义。

// SaveTexture 保存单张贴图。
func (s *ImportedModelStore) SaveTexture(id, relPath, dataURL string) (*ImportedTextureSaved, error) {
	if !validModelID(id) {
		return nil, fmt.Errorf("invalid model id")
	}
	rel, err := assertValidTextureRel(relPath)
	if err != nil {
		return nil, err
	}
	// 复用 nodeproject.go 的 decodeDataURL：它已做 data URL 格式校验与大小上限。
	_, buf := decodeDataURL(dataURL, maxTextureBytes)
	if buf == nil {
		return nil, fmt.Errorf("invalid or too large dataUrl")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	dest := filepath.Join(s.dir, id, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(dest, buf, 0o644); err != nil {
		return nil, err
	}
	return &ImportedTextureSaved{Path: rel, Size: len(buf)}, nil
}

// SaveTextures 批量保存贴图，返回成功项。
//
// 单项失败跳过而不中断：前端一次选多张图，其中一张不合法不应让整批失败。
func (s *ImportedModelStore) SaveTextures(id string, textures map[string]string) ([]ImportedTextureSaved, error) {
	if !validModelID(id) {
		return nil, fmt.Errorf("invalid model id")
	}
	if textures == nil {
		return nil, fmt.Errorf("textures map required")
	}
	saved := make([]ImportedTextureSaved, 0, len(textures))
	for rel, dataURL := range textures {
		item, err := s.SaveTexture(id, rel, dataURL)
		if err != nil {
			continue
		}
		saved = append(saved, *item)
	}
	sort.Slice(saved, func(i, j int) bool { return saved[i].Path < saved[j].Path })
	return saved, nil
}

// ListTextures 递归列出模型 assets/ 下的全部贴图。
//
// 模型目录不存在时返回空列表（新导入的模型还没有贴图是正常状态）。
func (s *ImportedModelStore) ListTextures(id string) ([]ImportedTexture, error) {
	if !validModelID(id) {
		return nil, fmt.Errorf("invalid model id")
	}
	root := filepath.Join(s.dir, id, textureRootPrefix)

	out := []ImportedTexture{}
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(d.Name()), "."))
		if _, ok := textureExts[ext]; !ok {
			return nil
		}
		rel, err := filepath.Rel(filepath.Join(s.dir, id), p)
		if err != nil {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		out = append(out, ImportedTexture{
			Path:  filepath.ToSlash(rel),
			Size:  info.Size(),
			Mtime: float64(info.ModTime().UnixMilli()),
		})
		return nil
	})

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// DeleteTexture 删除单张贴图；不存在时视为成功（幂等）。
func (s *ImportedModelStore) DeleteTexture(id, relPath string) (map[string]any, error) {
	if !validModelID(id) {
		return nil, fmt.Errorf("invalid model id")
	}
	rel, err := assertValidTextureRel(relPath)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	full := filepath.Join(s.dir, id, filepath.FromSlash(rel))
	_ = os.Remove(full)
	return map[string]any{"path": rel}, nil
}
