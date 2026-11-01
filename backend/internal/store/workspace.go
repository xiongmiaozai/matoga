// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// nowMillis 返回当前毫秒时间戳（与 Node 的 Date.now() 对齐）。
func nowMillis() float64 {
	return float64(time.Now().UnixMilli())
}

// 工作区预设的存储布局（与 Node 版 server/config/workspace-store.js 一致）：
//
//	<DataRoot>/data/workspaces/index.json   索引（active + items: name → 文件名）
//	<DataRoot>/data/workspaces/<file>.json  单个预设（name/config/updatedAt）
//
// 旧版单文件 <DataRoot>/data/workspaces.json 在首次访问时迁移为多文件布局，
// 迁移完成后重命名为 workspaces.json.bak。
const (
	workspaceIndexVersion = 1
	workspaceLegacySuffix = ".bak"
)

// workspaceIndex 是 index.json 的结构。
type workspaceIndex struct {
	Version int               `json:"version"`
	Active  *string           `json:"active"`
	Items   map[string]string `json:"items"`
}

// workspacePreset 是单个预设文件的结构。
type workspacePreset struct {
	Name      string  `json:"name"`
	Config    any     `json:"config"`
	UpdatedAt float64 `json:"updatedAt"`
}

// WorkspacePreset 是对外暴露的预设（不含文件名）。
type WorkspacePreset struct {
	Config    any      `json:"config"`
	UpdatedAt *float64 `json:"updatedAt"`
}

// WorkspaceSnapshot 是 GET /api/workspace 的响应体。
type WorkspaceSnapshot struct {
	Presets map[string]WorkspacePreset `json:"presets"`
	Active  *string                    `json:"active"`
}

// WorkspaceStore 管理工作区预设的读写。
type WorkspaceStore struct {
	dir        string
	indexFile  string
	legacyFile string
	legacyBak  string
	log        *slog.Logger
	mu         sync.Mutex
	migrated   bool
}

// NewWorkspaceStore 创建存储，dir 为 <DataRoot>/data。
func NewWorkspaceStore(dataDir string, log *slog.Logger) *WorkspaceStore {
	dir := filepath.Join(dataDir, "workspaces")
	return &WorkspaceStore{
		dir:        dir,
		indexFile:  filepath.Join(dir, "index.json"),
		legacyFile: filepath.Join(dataDir, "workspaces.json"),
		legacyBak:  filepath.Join(dataDir, "workspaces.json"+workspaceLegacySuffix),
		log:        log,
	}
}

// Dir 返回预设文件所在目录。
func (s *WorkspaceStore) Dir() string { return s.dir }

// safeName 把预设名清洗成可用作文件名的形式。
func safeName(name string) string {
	repl := strings.NewReplacer(
		`\`, "_", "/", "_", ":", "_", "*", "_", "?", "_",
		`"`, "_", "<", "_", ">", "_", "|", "_",
	)
	s := repl.Replace(name)
	s = strings.Trim(s, " \t\r\n.")
	if s == "" {
		return "unnamed"
	}
	return s
}

// allocFilename 为 name 分配一个不与 items 中其他预设冲突的文件名。
func allocFilename(name string, items map[string]string, excludeName string) string {
	base := safeName(name)
	filename := base + ".json"
	n := 1
	for {
		clash := false
		for nm, fn := range items {
			if fn == filename && nm != excludeName {
				clash = true
				break
			}
		}
		if !clash {
			return filename
		}
		filename = base + "." + itoa(n) + ".json"
		n++
	}
}

// itoa 是 strconv.Itoa 的轻量替代，避免为单处调用引入依赖。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// readIndex 读取索引，文件不存在或损坏时返回空索引。
func (s *WorkspaceStore) readIndex() workspaceIndex {
	idx := workspaceIndex{Version: workspaceIndexVersion, Items: map[string]string{}}
	buf, err := os.ReadFile(s.indexFile)
	if err != nil {
		if !os.IsNotExist(err) {
			s.warn("bad index.json: " + err.Error())
		}
		return idx
	}
	var raw struct {
		Version int               `json:"version"`
		Active  *string           `json:"active"`
		Items   map[string]string `json:"items"`
	}
	if err := json.Unmarshal(buf, &raw); err != nil {
		s.warn("bad index.json: " + err.Error())
		return idx
	}
	if raw.Version != 0 {
		idx.Version = raw.Version
	}
	idx.Active = raw.Active
	if raw.Items != nil {
		idx.Items = raw.Items
	}
	return idx
}

// writeIndex 原子写入索引。
func (s *WorkspaceStore) writeIndex(idx workspaceIndex) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	return AtomicWriteJSON(s.indexFile, idx)
}

// writePreset 原子写入单个预设文件。
func (s *WorkspaceStore) writePreset(filename string, p workspacePreset) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	return AtomicWriteJSON(filepath.Join(s.dir, filename), p)
}

// readPreset 读取单个预设文件，失败返回 nil。
func (s *WorkspaceStore) readPreset(filename string) *workspacePreset {
	buf, err := os.ReadFile(filepath.Join(s.dir, filename))
	if err != nil {
		if !os.IsNotExist(err) {
			s.warn("bad preset file " + filename + ": " + err.Error())
		}
		return nil
	}
	var p workspacePreset
	if err := json.Unmarshal(buf, &p); err != nil {
		s.warn("bad preset file " + filename + ": " + err.Error())
		return nil
	}
	return &p
}

// migrateIfNeeded 把旧版单文件 workspaces.json 迁移为多文件布局。
func (s *WorkspaceStore) migrateIfNeeded() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.migrated {
		return
	}
	s.migrated = true
	if _, err := os.Stat(s.dir); err == nil {
		return
	}
	buf, err := os.ReadFile(s.legacyFile)
	if err != nil {
		return
	}
	var raw struct {
		Presets map[string]struct {
			Config    any     `json:"config"`
			UpdatedAt float64 `json:"updatedAt"`
		} `json:"presets"`
		Active *string `json:"active"`
	}
	if err := json.Unmarshal(buf, &raw); err != nil {
		s.errf("migration failed: " + err.Error())
		return
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		s.errf("migration failed: " + err.Error())
		return
	}
	items := map[string]string{}
	for name, preset := range raw.Presets {
		filename := allocFilename(name, items, "")
		updated := preset.UpdatedAt
		if updated == 0 {
			updated = nowMillis()
		}
		if err := s.writePreset(filename, workspacePreset{
			Name: name, Config: preset.Config, UpdatedAt: updated,
		}); err != nil {
			s.errf("migration write failed: " + err.Error())
			continue
		}
		items[name] = filename
	}
	if err := s.writeIndex(workspaceIndex{
		Version: workspaceIndexVersion, Active: raw.Active, Items: items,
	}); err != nil {
		s.errf("migration index failed: " + err.Error())
		return
	}
	if err := os.Rename(s.legacyFile, s.legacyBak); err != nil {
		s.warn("rename legacy bak failed: " + err.Error())
	}
	s.info("migrated " + itoa(len(items)) + " presets to multi-file storage")
}

// Get 返回全部预设与当前激活项。
func (s *WorkspaceStore) Get() WorkspaceSnapshot {
	s.migrateIfNeeded()
	idx := s.readIndex()
	presets := map[string]WorkspacePreset{}
	for name, filename := range idx.Items {
		p := s.readPreset(filename)
		if p == nil || p.Config == nil {
			continue
		}
		var updated *float64
		if p.UpdatedAt != 0 {
			v := p.UpdatedAt
			updated = &v
		}
		presets[name] = WorkspacePreset{Config: p.Config, UpdatedAt: updated}
	}
	return WorkspaceSnapshot{Presets: presets, Active: idx.Active}
}

// SavePreset 保存（或覆盖）一个预设。
func (s *WorkspaceStore) SavePreset(name string, config any) error {
	if name == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "name required")
	}
	s.migrateIfNeeded()
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.readIndex()
	filename := allocFilename(name, idx.Items, name)
	if err := s.writePreset(filename, workspacePreset{
		Name: name, Config: config, UpdatedAt: nowMillis(),
	}); err != nil {
		s.errf("savePreset failed: " + err.Error())
		return err
	}
	idx.Items[name] = filename
	if err := s.writeIndex(idx); err != nil {
		s.errf("savePreset failed: " + err.Error())
		return err
	}
	return nil
}

// DeletePreset 删除一个预设；不存在时静默返回。
func (s *WorkspaceStore) DeletePreset(name string) error {
	s.migrateIfNeeded()
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.readIndex()
	filename, ok := idx.Items[name]
	if !ok {
		return nil
	}
	_ = os.Remove(filepath.Join(s.dir, filename))
	delete(idx.Items, name)
	if idx.Active != nil && *idx.Active == name {
		idx.Active = nil
	}
	if err := s.writeIndex(idx); err != nil {
		s.errf("deletePreset failed: " + err.Error())
		return err
	}
	return nil
}

// RenamePreset 重命名预设；原名不存在时静默返回。
func (s *WorkspaceStore) RenamePreset(oldName, newName string) error {
	if newName == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "name required")
	}
	s.migrateIfNeeded()
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.readIndex()
	oldFilename, ok := idx.Items[oldName]
	if !ok {
		return nil
	}
	oldPreset := s.readPreset(oldFilename)
	if oldPreset == nil {
		return nil
	}
	newFilename := allocFilename(newName, idx.Items, oldName)
	if existing, ok := idx.Items[newName]; ok && newName != oldName && existing != newFilename {
		_ = os.Remove(filepath.Join(s.dir, existing))
	}
	updated := oldPreset.UpdatedAt
	if updated == 0 {
		updated = nowMillis()
	}
	if err := s.writePreset(newFilename, workspacePreset{
		Name: newName, Config: oldPreset.Config, UpdatedAt: updated,
	}); err != nil {
		s.errf("renamePreset failed: " + err.Error())
		return err
	}
	if newFilename != oldFilename {
		_ = os.Remove(filepath.Join(s.dir, oldFilename))
	}
	delete(idx.Items, oldName)
	idx.Items[newName] = newFilename
	if idx.Active != nil && *idx.Active == oldName {
		idx.Active = &newName
	}
	if err := s.writeIndex(idx); err != nil {
		s.errf("renamePreset failed: " + err.Error())
		return err
	}
	return nil
}

// SetActive 设置激活预设，name 为空表示清空。
func (s *WorkspaceStore) SetActive(name string) error {
	s.migrateIfNeeded()
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := s.readIndex()
	if name == "" {
		idx.Active = nil
	} else {
		idx.Active = &name
	}
	if err := s.writeIndex(idx); err != nil {
		s.errf("setActive failed: " + err.Error())
		return err
	}
	return nil
}

func (s *WorkspaceStore) warn(msg string) {
	if s.log != nil {
		s.log.Warn("workspace: " + msg)
	}
}

func (s *WorkspaceStore) info(msg string) {
	if s.log != nil {
		s.log.Info("workspace: " + msg)
	}
}

func (s *WorkspaceStore) errf(msg string) {
	if s.log != nil {
		s.log.Error("workspace: " + msg)
	}
}
