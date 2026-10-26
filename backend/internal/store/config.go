// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package store 管理持久化的 JSON 配置与目录数据。
package store

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/xiongmiaozai/matoga/backend/internal/platform"
)

// defaultConfig 是配置的默认值，键与 Node 版 SCHEMA 一致。
var defaultConfig = map[string]any{
	"locale":        "zh",
	"theme":         "light",
	"recursive":     false,
	"hash":          false,
	"onlyMissing":   false,
	"ignoreSys":     true,
	"ignoreCustom":  "",
	"viewMode":      "all",
	"sortKey":       "status",
	"sortDir":       "asc",
	"statusFilter":  "all",
	"typeFilter":    "all",
	"contentFilter": "all",
	"categoryFilter": map[string]any{
		"type": "all", "content": "all", "status": "all", "folder": "all", "tag": "all",
	},
}

// Config 是配置存储。
type Config struct {
	mu     sync.Mutex
	file   string
	dataD  string
	root   string
	preset string
	log    *slog.Logger
}

// NewConfig 创建配置存储。
func NewConfig(paths platform.Paths, log *slog.Logger) *Config {
	dataDir := filepath.Join(paths.DataRoot, "data")
	return &Config{
		file:   filepath.Join(dataDir, "config.json"),
		dataD:  dataDir,
		root:   paths.DataRoot,
		preset: paths.PresetRoot,
		log:    log,
	}
}

// File 返回配置文件路径。
func (c *Config) File() string { return c.file }

func (c *Config) readRaw() map[string]any {
	raw, err := os.ReadFile(c.file)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			c.log.Warn("config", "read failed", "err", err)
		}
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		c.log.Warn("config", "bad config.json", "err", err)
		return map[string]any{}
	}
	return m
}

// Get 返回补全默认值后的配置。
func (c *Config) Get() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.merged()
}

// merged 需在持锁状态下调用。
func (c *Config) merged() map[string]any {
	raw := c.readRaw()
	out := make(map[string]any, len(defaultConfig)+len(raw)+5)
	for k, v := range defaultConfig {
		if cm, ok := v.(map[string]any); ok {
			cp := make(map[string]any, len(cm))
			for ck, cv := range cm {
				cp[ck] = cv
			}
			out[k] = cp
			continue
		}
		out[k] = v
	}
	for k, v := range raw {
		out[k] = v
	}
	setDefaultPath(out, "hdriPresetPath", filepath.Join(c.preset, "hdri-presets"))
	setDefaultPath(out, "mcPacksPath", filepath.Join(c.preset, "mc-packs"))
	setDefaultPath(out, "officialPacksPath", filepath.Join(c.preset, "official-packs"))
	setDefaultPath(out, "craftPacksPath", filepath.Join(c.preset, "craft-packs"))
	setDefaultPath(out, "userPacksPath", filepath.Join(c.dataD, "user-packs"))
	return out
}

func setDefaultPath(out map[string]any, key, fallback string) {
	if v, ok := out[key].(string); ok && v != "" {
		return
	}
	out[key] = fallback
}

// Put 合并并原子写回配置。
func (c *Config) Put(patch map[string]any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	merged := c.merged()
	for k, v := range patch {
		merged[k] = v
	}
	delete(merged, "windowBounds")
	return c.atomicWrite(merged)
}

// Clear 重置为空配置（保留默认值语义）。
func (c *Config) Clear() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.atomicWrite(map[string]any{})
}

func (c *Config) atomicWrite(cfg map[string]any) error {
	if err := os.MkdirAll(c.dataD, 0o755); err != nil {
		return err
	}
	buf, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(c.dataD, "config-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(buf); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, c.file); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// Export 供其他 store 复用原子写。
func AtomicWriteJSON(file string, v any) error {
	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	buf, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(file)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(buf); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, file)
}
