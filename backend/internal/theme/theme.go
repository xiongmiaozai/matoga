// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package theme 管理界面主题：4 个内置主题 + 用户自定义主题。
//
// 自定义主题以 <id>.json 存在 data/themes/ 下，启动时按需扫描。
// 只读写该目录，不触碰任何业务数据。
package theme

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// tokenWhitelist 是允许外部写入的 CSS 变量白名单。
//
// 白名单而非黑名单：主题只应覆盖配色/圆角/字号等外观变量，
// 不允许注入能改变布局或执行脚本的值。
var tokenWhitelist = map[string]struct{}{
	"--bg": {}, "--panel-bg": {}, "--panel-2": {}, "--panel-3": {},
	"--border": {}, "--border-soft": {},
	"--text": {}, "--text-muted": {}, "--text-dim": {},
	"--primary": {}, "--primary-hover": {}, "--primary-soft": {},
	"--accent": {}, "--accent-hover": {}, "--accent-soft": {},
	"--danger": {}, "--danger-soft": {}, "--warn": {}, "--warn-soft": {},
	"--partial": {}, "--partial-soft": {}, "--extra": {}, "--extra-soft": {},
	"--tag-left-bg": {}, "--tag-left-fg": {}, "--tag-right-bg": {}, "--tag-right-fg": {},
	"--tag-left-ring": {}, "--tag-right-ring": {},
	"--primary-glow": {}, "--row-hover": {}, "--zebra": {}, "--selected": {},
	"--checker": {}, "--checker-2": {},
	"--shadow-1": {}, "--shadow-2": {}, "--shadow-3": {},
	"--radius-sm": {}, "--radius-md": {}, "--radius": {}, "--radius-lg": {}, "--radius-xl": {},
	"--fs-xs": {}, "--fs-sm": {}, "--fs-md": {}, "--fs-base": {}, "--fs-lg": {}, "--fs-xl": {}, "--fs-2xl": {},
	"--ease":     {},
	"--mc-grass": {}, "--mc-grass-dark": {}, "--mc-stone": {}, "--mc-stone-dark": {},
	"--mc-dirt": {}, "--mc-dirt-dark": {}, "--mc-diamond": {}, "--mc-diamond-dark": {},
	"--mc-dark": {}, "--mc-darker": {},
	"--mc-border-light": {}, "--mc-border-dark": {},
}

// idRE 限定自定义主题 id 的形状，避免路径穿越。
var idRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// Theme 是一个主题定义。字段与前端约定一致。
type Theme struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Builtin bool              `json:"builtin"`
	Base    any               `json:"base"` // nil 或内置主题 id 字符串
	Mode    string            `json:"mode"`
	Tokens  map[string]string `json:"tokens"`
}

// Catalog 是列表返回。
type Catalog struct {
	Builtin []Theme `json:"builtin"`
	Custom  []Theme `json:"custom"`
}

// builtin 是四个固定主题。顺序即前端展示顺序。
var builtin = []Theme{
	{ID: "light", Name: "浅色", Builtin: true, Base: nil, Mode: "light", Tokens: map[string]string{}},
	{ID: "dark", Name: "深色", Builtin: true, Base: nil, Mode: "dark", Tokens: map[string]string{}},
	{ID: "mc", Name: "Minecraft", Builtin: true, Base: nil, Mode: "light", Tokens: map[string]string{}},
	{ID: "mc-dark", Name: "Minecraft 深色", Builtin: true, Base: nil, Mode: "dark", Tokens: map[string]string{}},
}

var builtinIDs = func() map[string]struct{} {
	m := make(map[string]struct{}, len(builtin))
	for _, t := range builtin {
		m[t.ID] = struct{}{}
	}
	return m
}()

// Store 读写 data/themes。
type Store struct {
	dir string
}

// NewStore 创建存储。dir 为 data/themes 的完整路径。
func NewStore(dir string) *Store {
	_ = os.MkdirAll(dir, 0o755)
	return &Store{dir: dir}
}

// Dir 返回主题目录。
func (s *Store) Dir() string { return s.dir }

// List 返回内置与自定义主题。
func (s *Store) List() Catalog {
	cp := make([]Theme, len(builtin))
	copy(cp, builtin)
	return Catalog{Builtin: cp, Custom: s.readCustom()}
}

// Get 按 id 查主题；不存在返回 nil。
func (s *Store) Get(id string) *Theme {
	if _, ok := builtinIDs[id]; ok {
		for i := range builtin {
			if builtin[i].ID == id {
				t := builtin[i]
				return &t
			}
		}
		return nil
	}
	for _, t := range s.readCustom() {
		if t.ID == id {
			tt := t
			return &tt
		}
	}
	return nil
}

// Put 写入（或覆盖）一个自定义主题。
func (s *Store) Put(id string, def Theme) (*Theme, error) {
	if !idRE.MatchString(id) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "bad id")
	}
	if _, ok := builtinIDs[id]; ok {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "cannot overwrite builtin")
	}
	rec := Theme{
		ID:      id,
		Name:    truncate(def.Name, 64, id),
		Builtin: false,
		Base:    normalizeBase(def.Base),
		Mode:    normalizeMode(def.Mode),
		Tokens:  sanitizeTokens(def.Tokens),
	}
	if err := store.AtomicWriteJSON(filepath.Join(s.dir, id+".json"), rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

// Delete 删除自定义主题；文件不存在返回 false。
func (s *Store) Delete(id string) (bool, error) {
	if !idRE.MatchString(id) {
		return false, httpx.Errorf(httpx.CodeInvalidParam, "bad id")
	}
	if _, ok := builtinIDs[id]; ok {
		return false, httpx.Errorf(httpx.CodeInvalidParam, "cannot delete builtin")
	}
	err := os.Remove(filepath.Join(s.dir, id+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Import 导入一个主题：沿用给定 id（合法时），否则生成随机 id。
func (s *Store) Import(def Theme) (*Theme, error) {
	id := def.ID
	if !idRE.MatchString(id) {
		id = "theme-" + randomHex(4)
	}
	if _, ok := builtinIDs[id]; ok {
		id = "theme-" + randomHex(4)
	}
	return s.Put(id, def)
}

// readCustom 扫描目录下的 *.json。
//
// 坏文件静默跳过：单个损坏的主题不应让整个列表失败。
func (s *Store) readCustom() []Theme {
	out := []Theme{}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var def Theme
		if err := json.Unmarshal(raw, &def); err != nil {
			continue
		}
		id := def.ID
		if !idRE.MatchString(id) {
			id = strings.TrimSuffix(e.Name(), ".json")
		}
		if !idRE.MatchString(id) {
			continue
		}
		if _, ok := builtinIDs[id]; ok {
			continue
		}
		out = append(out, Theme{
			ID:      id,
			Name:    truncate(def.Name, 64, id),
			Builtin: false,
			Base:    normalizeBase(def.Base),
			Mode:    normalizeMode(def.Mode),
			Tokens:  sanitizeTokens(def.Tokens),
		})
	}
	return out
}

// sanitizeTokens 只保留白名单内的字符串值，且长度受限。
func sanitizeTokens(raw map[string]string) map[string]string {
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		if _, ok := tokenWhitelist[k]; !ok {
			continue
		}
		if len(v) >= 256 {
			continue
		}
		out[k] = v
	}
	return out
}

// normalizeBase 把 base 收敛为 nil 或已知内置 id 字符串。
func normalizeBase(v any) any {
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return nil
	}
	if _, ok := builtinIDs[s]; ok {
		return s
	}
	return "light"
}

// normalizeMode 只允许 light / dark。
func normalizeMode(m string) string {
	if m == "dark" {
		return "dark"
	}
	return "light"
}

// truncate 截断到 max 个 rune；空值用 fallback。
func truncate(s string, max int, fallback string) string {
	r := []rune(s)
	if len(r) == 0 {
		return fallback
	}
	if len(r) > max {
		return string(r[:max])
	}
	return s
}

// randomHex 生成 n 字节的十六进制串。
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "00000000"
	}
	return hex.EncodeToString(b)
}
