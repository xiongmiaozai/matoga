// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// 导入模型存储布局（与 Node 版 server/services/imported-model-service.js 一致）：
//
//	<DataRoot>/data/imported-models/<id>/model.<ext>   ext ∈ {bbmodel, json}
//
// 旧版扁平文件 <id>.bbmodel / <id>.json 在列表时惰性迁移为子目录布局。
const (
	ImportedModelBasename = "model"
	importedModelMaxIDLen = 128
)

// importedModelExts 是允许的扩展名，顺序决定查找优先级。
var importedModelExts = []string{"bbmodel", "json"}

// importedLegacyRe 匹配旧版扁平文件名。
var importedLegacyRe = regexp.MustCompile(`^(.+)\.(bbmodel|json)$`)

// ImportedModel 是列表里的一条模型记录。
type ImportedModel struct {
	ID          string  `json:"id"`
	File        string  `json:"file"`
	Ext         string  `json:"ext"`
	Size        int64   `json:"size"`
	Mtime       float64 `json:"mtime"`
	Name        string  `json:"name,omitempty"`
	Format      string  `json:"format,omitempty"`
	ModelFormat string  `json:"model_format,omitempty"`
}

// ImportedModelContent 是 GET /api/imported-models/:id 的响应体。
type ImportedModelContent struct {
	ID   string `json:"id"`
	Raw  string `json:"raw"`
	JSON any    `json:"json"`
}

// ImportedModelStore 管理导入模型的读写。
type ImportedModelStore struct {
	dir string
	mu  sync.Mutex
}

// NewImportedModelStore 创建存储，dataDir 为 <DataRoot>/data。
func NewImportedModelStore(dataDir string) *ImportedModelStore {
	return &ImportedModelStore{dir: filepath.Join(dataDir, "imported-models")}
}

// Dir 返回导入模型根目录。
func (s *ImportedModelStore) Dir() string { return s.dir }

// validModelID 校验模型 id：非空、长度 ≤128、不含路径分隔符与冒号。
func validModelID(id string) bool {
	if id == "" || len(id) > importedModelMaxIDLen {
		return false
	}
	if strings.ContainsAny(id, `/\:`) {
		return false
	}
	return id != "." && id != ".."
}

// modelFileIn 返回 dir 下首个 model.<ext> 的绝对路径，没有则返回空串。
func modelFileIn(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	names := make(map[string]bool, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names[e.Name()] = true
		}
	}
	for _, ext := range importedModelExts {
		f := ImportedModelBasename + "." + ext
		if names[f] {
			return filepath.Join(dir, f)
		}
	}
	return ""
}

// normalizeExt 推断扩展名：显式合法值 > 文件名后缀 > 内容 meta.format > json。
func normalizeExt(ext, name string, data []byte) string {
	for _, e := range importedModelExts {
		if ext == e {
			return e
		}
	}
	lname := strings.ToLower(name)
	if strings.HasSuffix(lname, ".bbmodel") {
		return "bbmodel"
	}
	if strings.HasSuffix(lname, ".json") {
		return "json"
	}
	var parsed struct {
		Meta struct {
			Format      string `json:"format"`
			ModelFormat string `json:"model_format"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(data, &parsed); err == nil {
		if parsed.Meta.Format == "bbmodel" || parsed.Meta.ModelFormat != "" {
			return "bbmodel"
		}
	}
	return "json"
}

// migrateLegacy 把旧版扁平文件迁移到子目录布局（幂等）。
func (s *ImportedModelStore) migrateLegacy() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := importedLegacyRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		id, ext := m[1], m[2]
		if !validModelID(id) {
			continue
		}
		dir := filepath.Join(s.dir, id)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		_ = os.Rename(
			filepath.Join(s.dir, e.Name()),
			filepath.Join(dir, ImportedModelBasename+"."+ext),
		)
	}
}

// List 返回全部导入模型，按 mtime 倒序。
func (s *ImportedModelStore) List() ([]ImportedModel, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.migrateLegacy()
	s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return []ImportedModel{}, nil
	}
	out := []ImportedModel{}
	for _, e := range entries {
		if !e.IsDir() || !validModelID(e.Name()) {
			continue
		}
		p := modelFileIn(filepath.Join(s.dir, e.Name()))
		if p == "" {
			continue
		}
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		item := ImportedModel{
			ID:    e.Name(),
			File:  filepath.Base(p),
			Ext:   strings.TrimPrefix(filepath.Ext(p), "."),
			Size:  info.Size(),
			Mtime: float64(info.ModTime().UnixMilli()),
		}
		// 尽力从内容里补 name/format，失败不影响列表
		if buf, err := os.ReadFile(p); err == nil {
			var j struct {
				Name string `json:"name"`
				Meta struct {
					Format      string `json:"format"`
					ModelFormat string `json:"model_format"`
				} `json:"meta"`
			}
			if json.Unmarshal(buf, &j) == nil {
				item.Name = j.Name
				item.Format = j.Meta.Format
				item.ModelFormat = j.Meta.ModelFormat
			}
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Mtime > out[j].Mtime })
	return out, nil
}

// ImportedModelSaveInput 是导入请求的入参。
type ImportedModelSaveInput struct {
	ID   string
	Name string
	Data []byte
	Ext  string
}

// ImportedModelSaveResult 是导入成功的返回值。
type ImportedModelSaveResult struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Ext  string `json:"ext"`
	Size int    `json:"size"`
}

// Save 导入（或覆盖）一个模型。
func (s *ImportedModelStore) Save(in ImportedModelSaveInput) (*ImportedModelSaveResult, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	safeName := sanitizeModelName(in.Name)
	fid := in.ID
	if fid == "" {
		fid = safeName + "-" + itoaBase36(time.Now().UnixMilli())
	}
	if !validModelID(fid) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid model id")
	}
	ext := normalizeExt(in.Ext, in.Name, in.Data)
	dir := filepath.Join(s.dir, fid)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	p := filepath.Join(dir, ImportedModelBasename+"."+ext)

	s.mu.Lock()
	err := os.WriteFile(p, in.Data, 0o644)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return &ImportedModelSaveResult{ID: fid, Path: p, Ext: ext, Size: len(in.Data)}, nil
}

// sanitizeModelName 把模型名清洗成文件名安全形式。
func sanitizeModelName(name string) string {
	if name == "" {
		return "model"
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '_', r == '.', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "model"
	}
	return out
}

// Load 读取一个模型的原始内容与解析后的 JSON。
func (s *ImportedModelStore) Load(id string) (*ImportedModelContent, error) {
	if !validModelID(id) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid model id")
	}
	p := modelFileIn(filepath.Join(s.dir, id))
	if p == "" {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "model not found: "+id)
	}
	buf, err := os.ReadFile(p)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "model not found: "+id)
	}
	var parsed any
	_ = json.Unmarshal(buf, &parsed)
	return &ImportedModelContent{ID: id, Raw: string(buf), JSON: parsed}, nil
}

// ImportedModelUpdateResult 是覆盖更新的返回值。
type ImportedModelUpdateResult struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Size int    `json:"size"`
}

// Update 覆盖更新模型内容，保留原扩展名。
func (s *ImportedModelStore) Update(id string, data []byte) (*ImportedModelUpdateResult, error) {
	if !validModelID(id) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid model id")
	}
	p := modelFileIn(filepath.Join(s.dir, id))
	if p == "" {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "model not found: "+id)
	}
	s.mu.Lock()
	err := os.WriteFile(p, data, 0o644)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return &ImportedModelUpdateResult{ID: id, Path: p, Size: len(data)}, nil
}

// Delete 删除一个模型目录。
func (s *ImportedModelStore) Delete(id string) error {
	if !validModelID(id) {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid model id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.RemoveAll(filepath.Join(s.dir, id))
}

// itoaBase36 把非负整数转为 36 进制字符串。
func itoaBase36(n int64) string {
	if n == 0 {
		return "0"
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	var buf [16]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = digits[n%36]
		n /= 36
	}
	return string(buf[i:])
}
