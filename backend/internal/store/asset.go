// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// 资产类型与数量上限，与 Node 版一致。
const (
	MaxFavorites = 500
	MaxRecent    = 50
)

// validTypes 是资产键前缀允许的取值。
var validTypes = map[string]bool{
	"tex": true, "hdri": true, "mc": true, "official": true,
	"model": true, "preset": true, "project": true, "craft": true,
}

// AssetItem 是收藏夹/最近使用里的一条记录。
type AssetItem struct {
	Key   string  `json:"key"`
	Name  string  `json:"name"`
	Thumb *string `json:"thumb"`
	Type  string  `json:"type"`
	Path  *string `json:"path"`
	Mtime float64 `json:"mtime"`
	Role  string  `json:"role,omitempty"`
	Color string  `json:"color,omitempty"`
	Badge string  `json:"badge,omitempty"`
}

// AssetStore 把收藏夹与最近使用持久化到 data/asset-library/。
type AssetStore struct {
	dir       string
	favFile   string
	recFile   string
	legacy    string
	log       *slog.Logger
	mu        sync.Mutex
	writeLock sync.Mutex
}

// NewAssetStore 创建资产库存储；dataRoot 为运行时数据根目录。
func NewAssetStore(dataRoot string, log *slog.Logger) *AssetStore {
	dataDir := filepath.Join(dataRoot, "data")
	dir := filepath.Join(dataDir, "asset-library")
	s := &AssetStore{
		dir:     dir,
		favFile: filepath.Join(dir, "favorites.json"),
		recFile: filepath.Join(dir, "recent.json"),
		legacy:  filepath.Join(dataDir, "assets.json"),
		log:     log,
	}
	s.migrateLegacy()
	return s
}

// Dir 返回资产库目录。
func (s *AssetStore) Dir() string { return s.dir }

// DetectType 从 "tex:xxx" 形式的键推断类型；非法返回空串。
func DetectType(key string) string {
	idx := strings.Index(key, ":")
	if idx <= 0 {
		return ""
	}
	prefix := key[:idx]
	if !validTypes[prefix] {
		return ""
	}
	return prefix
}

// ValidType 判断类型是否合法。
func ValidType(t string) bool { return validTypes[t] }

func sanitizeItem(it map[string]any) *AssetItem {
	key, _ := it["key"].(string)
	if key == "" {
		return nil
	}
	detected := DetectType(key)
	if detected == "" {
		return nil
	}
	if rawType, ok := it["type"]; ok {
		if ts, ok := rawType.(string); ok {
			if ts != "" && !validTypes[ts] {
				return nil
			}
			if ts != "" && ts != detected {
				return nil
			}
		}
	}
	item := &AssetItem{Key: key, Type: detected}
	if v, ok := it["name"].(string); ok {
		item.Name = v
	}
	if v, ok := it["thumb"].(string); ok {
		item.Thumb = &v
	}
	if v, ok := it["path"].(string); ok {
		item.Path = &v
	}
	if v, ok := it["mtime"].(float64); ok {
		item.Mtime = v
	}
	if v, ok := it["role"].(string); ok {
		item.Role = v
	}
	if v, ok := it["color"].(string); ok {
		item.Color = v
	}
	if v, ok := it["badge"].(string); ok {
		item.Badge = v
	}
	return item
}

// SanitizeList 清洗并去重，最多保留 max 条。
func SanitizeList(arr []any, max int) []AssetItem {
	out := make([]AssetItem, 0, len(arr))
	seen := make(map[string]bool, len(arr))
	for _, raw := range arr {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		s := sanitizeItem(m)
		if s == nil || seen[s.Key] {
			continue
		}
		seen[s.Key] = true
		out = append(out, *s)
		if len(out) >= max {
			break
		}
	}
	return out
}

func (s *AssetStore) readRaw(file string) map[string]any {
	raw, err := os.ReadFile(file)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			s.log.Warn("asset: read failed", "file", filepath.Base(file), "err", err.Error())
		}
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		s.log.Warn("asset: bad json", "file", filepath.Base(file), "err", err.Error())
		return map[string]any{}
	}
	return m
}

func (s *AssetStore) readList(file, field string, max int) []AssetItem {
	raw := s.readRaw(file)
	arr, _ := raw[field].([]any)
	return SanitizeList(arr, max)
}

// Favorites 返回收藏夹。
func (s *AssetStore) Favorites() []AssetItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readList(s.favFile, "favorites", MaxFavorites)
}

// Recent 返回最近使用。
func (s *AssetStore) Recent() []AssetItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readList(s.recFile, "recent", MaxRecent)
}

// AssetLibrary 是 /api/asset 的返回体。
type AssetLibrary struct {
	Favorites []AssetItem `json:"favorites"`
	Recent    []AssetItem `json:"recent"`
}

// Get 返回收藏夹与最近使用。
func (s *AssetStore) Get() AssetLibrary {
	return AssetLibrary{Favorites: s.Favorites(), Recent: s.Recent()}
}

// GetByType 按类型过滤。
func (s *AssetStore) GetByType(t string) AssetLibrary {
	if !validTypes[t] {
		return AssetLibrary{Favorites: []AssetItem{}, Recent: []AssetItem{}}
	}
	lib := s.Get()
	fav := make([]AssetItem, 0, len(lib.Favorites))
	for _, it := range lib.Favorites {
		if it.Type == t {
			fav = append(fav, it)
		}
	}
	rec := make([]AssetItem, 0, len(lib.Recent))
	for _, it := range lib.Recent {
		if it.Type == t {
			rec = append(rec, it)
		}
	}
	return AssetLibrary{Favorites: fav, Recent: rec}
}

// SetFavorites 覆盖写入收藏夹，返回落盘后的条数。
func (s *AssetStore) SetFavorites(items []any) (int, error) {
	clean := SanitizeList(items, MaxFavorites)
	s.writeLock.Lock()
	defer s.writeLock.Unlock()
	if err := AtomicWriteJSON(s.favFile, map[string]any{"favorites": clean}); err != nil {
		s.log.Error("asset: setFavorites failed", "err", err.Error())
		return 0, err
	}
	return len(clean), nil
}

// SetRecent 覆盖写入最近使用，返回落盘后的条数。
func (s *AssetStore) SetRecent(items []any) (int, error) {
	clean := SanitizeList(items, MaxRecent)
	s.writeLock.Lock()
	defer s.writeLock.Unlock()
	if err := AtomicWriteJSON(s.recFile, map[string]any{"recent": clean}); err != nil {
		s.log.Error("asset: setRecent failed", "err", err.Error())
		return 0, err
	}
	return len(clean), nil
}

// migrateLegacy 把旧的 data/assets.json 迁移到 asset-library/ 下。
func (s *AssetStore) migrateLegacy() {
	if _, err := os.Stat(s.legacy); err != nil {
		return
	}
	if _, err := os.Stat(s.favFile); err == nil {
		return
	}
	if _, err := os.Stat(s.recFile); err == nil {
		return
	}
	raw, err := os.ReadFile(s.legacy)
	if err != nil {
		s.log.Warn("asset: legacy migration skipped", "err", err.Error())
		return
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		s.log.Warn("asset: legacy migration skipped", "err", err.Error())
		return
	}
	favArr, _ := m["favorites"].([]any)
	recArr, _ := m["recent"].([]any)
	fav := SanitizeList(favArr, MaxFavorites)
	rec := SanitizeList(recArr, MaxRecent)
	if len(fav) > 0 {
		_ = AtomicWriteJSON(s.favFile, map[string]any{"favorites": fav})
	}
	if len(rec) > 0 {
		_ = AtomicWriteJSON(s.recFile, map[string]any{"recent": rec})
	}
	s.log.Info("asset: migrated legacy assets.json -> asset-library/")
}
