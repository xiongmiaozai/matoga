// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// CustomModelBasename 是每个模型目录内的固定文件名。
const CustomModelBasename = "model"

// customModelTemplatesJSON 由 Node 版 custom-model-service.js 的 TEMPLATES
// 导出：每个模板的 model 是 generate('zznamezz','zznszz') 的结果，运行时把
// 这两个哨兵替换为真实名字与命名空间即可，避免在 Go 里重写 15 套几何构造。
//
//go:embed custommodel_templates.json
var customModelTemplatesJSON []byte

// customModelTemplate 是模板的元信息与哨兵模型。
type customModelTemplate struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	Description string          `json:"description"`
	Model       json.RawMessage `json:"model"`
}

// CustomModelTemplateInfo 是 /templates 返回的条目（不含 model）。
type CustomModelTemplateInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

var (
	customTemplatesOnce sync.Once
	customTemplates     []customModelTemplate
	customTemplatesErr  error
)

// loadCustomTemplates 惰性解析内嵌模板。
func loadCustomTemplates() ([]customModelTemplate, error) {
	customTemplatesOnce.Do(func() {
		if err := json.Unmarshal(customModelTemplatesJSON, &customTemplates); err != nil {
			customTemplatesErr = fmt.Errorf("解析内嵌模型模板失败: %w", err)
		}
	})
	return customTemplates, customTemplatesErr
}

// ListCustomTemplates 返回模板元信息列表（顺序与 Node 版一致）。
func ListCustomTemplates() []CustomModelTemplateInfo {
	tpls, err := loadCustomTemplates()
	if err != nil {
		return nil
	}
	out := make([]CustomModelTemplateInfo, 0, len(tpls))
	for _, t := range tpls {
		out = append(out, CustomModelTemplateInfo{
			ID: t.ID, Name: t.Name, Category: t.Category, Description: t.Description,
		})
	}
	return out
}

// GenerateCustomModel 按模板生成模型 JSON。
//
// 与 Node 版 generateModel 等价：namespace 与 name 都先按
// `[^a-z0-9_\-]` 替换（namespace 删掉、name 换成下划线）再转小写，
// 空值回落 minecraft / model。
func GenerateCustomModel(template, name, namespace string) (model json.RawMessage, ns, safeName, tplID string, err error) {
	tpls, e := loadCustomTemplates()
	if e != nil {
		return nil, "", "", "", httpx.Errorf(httpx.CodeUnknown, fmt.Sprintf("%v", e))
	}
	var tpl *customModelTemplate
	for i := range tpls {
		if tpls[i].ID == template {
			tpl = &tpls[i]
			break
		}
	}
	if tpl == nil {
		return nil, "", "", "", httpx.Errorf(httpx.CodeInvalidParam, "未知模板: "+template)
	}

	ns = strings.ToLower(customNsRe.ReplaceAllString(namespace, ""))
	if ns == "" {
		ns = "minecraft"
	}
	safeName = strings.ToLower(customNameRe.ReplaceAllString(name, "_"))
	if safeName == "" {
		safeName = "model"
	}

	sub := strings.NewReplacer("zznamezz", safeName, "zznszz", ns).Replace(string(tpl.Model))
	if !json.Valid([]byte(sub)) {
		return nil, "", "", "", httpx.Errorf(httpx.CodeUnknown, "模板生成失败")
	}
	return json.RawMessage(sub), ns, safeName, tpl.ID, nil
}

var (
	// customNsRe 对应 JS 的 /[^a-z0-9_\-]/gi —— 注意 JS 的 \w 只含 ASCII。
	customNsRe = regexp.MustCompile(`[^a-zA-Z0-9_\-]`)
	// customNameRe 对应 /[^a-z0-9_\-]/gi 的替换版本（换成下划线）。
	customNameRe = regexp.MustCompile(`[^a-zA-Z0-9_\-]`)
)

// CustomModelStore 管理 data/custom-models/<id>/model.json。
type CustomModelStore struct {
	dir string
	mu  sync.Mutex
}

// NewCustomModelStore 创建 store。
func NewCustomModelStore(dataRoot string) *CustomModelStore {
	return &CustomModelStore{dir: filepath.Join(dataRoot, "data", "custom-models")}
}

// Dir 返回专属目录。
func (s *CustomModelStore) Dir() string { return s.dir }

// CustomModelRecord 是落盘的记录结构。
type CustomModelRecord struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Namespace string          `json:"namespace"`
	Template  string          `json:"template"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt,omitempty"`
	Model     json.RawMessage `json:"model"`
}

// CustomModelSummary 是列表条目。
type CustomModelSummary struct {
	ID          string `json:"id"`
	File        string `json:"file"`
	Size        int64  `json:"size"`
	Mtime       int64  `json:"mtime"`
	Name        string `json:"name,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	Template    string `json:"template,omitempty"`
	Parent      string `json:"parent,omitempty"`
	HasElements bool   `json:"hasElements"`
}

// CustomModelLoadResult 是读取结果。
type CustomModelLoadResult struct {
	ID   string          `json:"id"`
	Raw  string          `json:"raw"`
	JSON json.RawMessage `json:"json"`
}

// CustomModelCreateResult 是创建结果。
type CustomModelCreateResult struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Size      int    `json:"size"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Template  string `json:"template"`
}

// validCustomModelID 与 Node 版 validId 一致。
func validCustomModelID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	if strings.ContainsAny(id, `/\:`) {
		return false
	}
	return id != "." && id != ".."
}

func assertValidCustomModelID(id string) error {
	if !validCustomModelID(id) {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid model id")
	}
	return nil
}

// modelFileIn 返回目录内的 model.json（不存在返回空串）。
func customModelFileIn(dir string) string {
	p := filepath.Join(dir, CustomModelBasename+".json")
	if st, err := os.Stat(p); err == nil && !st.IsDir() {
		return p
	}
	return ""
}

// migrateLegacy 把旧的扁平 <id>.json 迁到 <id>/model.json（幂等）。
func (s *CustomModelStore) migrateLegacy() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		if !validCustomModelID(id) {
			continue
		}
		dir := filepath.Join(s.dir, id)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		_ = os.Rename(
			filepath.Join(s.dir, e.Name()),
			filepath.Join(dir, CustomModelBasename+".json"),
		)
	}
}

// List 返回全部已创建模型，按 mtime 降序。
func (s *CustomModelStore) List() ([]CustomModelSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	s.migrateLegacy()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	out := make([]CustomModelSummary, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := customModelFileIn(filepath.Join(s.dir, e.Name()))
		if p == "" {
			continue
		}
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		item := CustomModelSummary{
			ID:    e.Name(),
			File:  CustomModelBasename + ".json",
			Size:  st.Size(),
			Mtime: st.ModTime().UnixMilli(),
		}
		// 尽力从内容补元信息，失败不影响列表
		if raw, err := os.ReadFile(p); err == nil {
			var rec CustomModelRecord
			if json.Unmarshal(raw, &rec) == nil {
				item.Name = rec.Name
				item.Namespace = rec.Namespace
				item.Template = rec.Template
				var probe struct {
					Parent   string            `json:"parent"`
					Elements []json.RawMessage `json:"elements"`
				}
				if len(rec.Model) > 0 && json.Unmarshal(rec.Model, &probe) == nil {
					item.Parent = probe.Parent
					item.HasElements = len(probe.Elements) > 0
				}
			}
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Mtime > out[j].Mtime })
	return out, nil
}

// Create 从模板创建模型。
func (s *CustomModelStore) Create(template, name, namespace string) (*CustomModelCreateResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	model, ns, safeName, tplID, err := GenerateCustomModel(template, name, namespace)
	if err != nil {
		return nil, err
	}
	fid := safeName + "-" + base36(time.Now().UnixMilli())
	dir := filepath.Join(s.dir, fid)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	rec := CustomModelRecord{
		ID: fid, Name: safeName, Namespace: ns, Template: tplID,
		CreatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Model:     model,
	}
	content, err := marshalIndent(rec)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeUnknown, fmt.Sprintf("%v", err))
	}
	p := filepath.Join(dir, CustomModelBasename+".json")
	if err := os.WriteFile(p, content, 0o644); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	return &CustomModelCreateResult{
		ID: fid, Path: p, Size: len(content),
		Name: safeName, Namespace: ns, Template: tplID,
	}, nil
}

// Load 读取模型记录。
func (s *CustomModelStore) Load(id string) (*CustomModelLoadResult, error) {
	if err := assertValidCustomModelID(id); err != nil {
		return nil, err
	}
	p := customModelFileIn(filepath.Join(s.dir, id))
	if p == "" {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "model not found: "+id)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	res := &CustomModelLoadResult{ID: id, Raw: string(raw)}
	if json.Valid(raw) {
		res.JSON = json.RawMessage(raw)
	}
	return res, nil
}

// Update 更新 model 与/或 name。
func (s *CustomModelStore) Update(id string, model json.RawMessage, hasModel bool, name *string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := assertValidCustomModelID(id); err != nil {
		return nil, err
	}
	p := customModelFileIn(filepath.Join(s.dir, id))
	if p == "" {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "model not found: "+id)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	var rec map[string]json.RawMessage
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("损坏的模型记录: %v", err))
	}
	if hasModel {
		// 前端可能传 JSON 字符串，先解一层
		trimmed := strings.TrimSpace(string(model))
		if strings.HasPrefix(trimmed, `"`) {
			var inner string
			if err := json.Unmarshal(model, &inner); err != nil {
				return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid model")
			}
			trimmed = inner
		}
		if !json.Valid([]byte(trimmed)) {
			return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid model")
		}
		rec["model"] = json.RawMessage(trimmed)
	}
	if name != nil {
		b, _ := json.Marshal(*name)
		rec["name"] = b
	}
	b, _ := json.Marshal(time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
	rec["updatedAt"] = b

	content, err := marshalIndent(rec)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeUnknown, fmt.Sprintf("%v", err))
	}
	if err := os.WriteFile(p, content, 0o644); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	return map[string]any{"id": id, "size": len(content)}, nil
}

// Delete 删除模型目录。
func (s *CustomModelStore) Delete(id string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := assertValidCustomModelID(id); err != nil {
		return nil, err
	}
	if err := os.RemoveAll(filepath.Join(s.dir, id)); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("%v", err))
	}
	return map[string]any{"id": id}, nil
}

// marshalIndent 等价 JSON.stringify(v, null, 2)：两空格缩进、无行尾换行。
func marshalIndent(v any) ([]byte, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	// Go 的 MarshalIndent 会把 RawMessage 里的 HTML 字符转义，这里还原
	b = jsonHTMLEscapeFix(b)
	return b, nil
}

// jsonHTMLEscapeFix 还原 MarshalIndent 对 <、>、& 的转义。
//
// Node 的 JSON.stringify 不转义这三个字符；Go 默认转成 \u003c 等。
// 为保证落盘内容与 Node 版一致（前端会直接读文件），这里做反向还原。
func jsonHTMLEscapeFix(b []byte) []byte {
	s := string(b)
	if !strings.Contains(s, `\u00`) {
		return b
	}
	s = strings.NewReplacer(
		`\u003c`, "<",
		`\u003e`, ">",
		`\u0026`, "&",
	).Replace(s)
	return []byte(s)
}

// base36 把毫秒时间戳转成小写 base36（等价 JS 的 Number.toString(36)）。
func base36(n int64) string {
	if n == 0 {
		return "0"
	}
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	var buf []byte
	for n > 0 {
		buf = append(buf, digits[n%36])
		n /= 36
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}

var _ = errors.New
