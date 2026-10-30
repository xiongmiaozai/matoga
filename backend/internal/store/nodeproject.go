// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package store

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// 节点工程存储布局（与 Node 版 server/config/node-project-store.js 一致）：
//
//	<DataRoot>/data/node-projects/<id>.mtgp/
//	  project.json    工程（format/version/meta/graph/textures）
//	  thumbnail.png   缩略图
//	  textures/       工程内贴图副本（保证工程自包含）
const (
	NodeProjectFormat      = "matoga-node-project"
	NodeProjectVersion     = 1
	NodeProjectMaxName     = 100
	NodeProjectMaxProjects = 500
	NodeProjectMaxThumb    = 4 * 1024 * 1024
	NodeProjectMaxTexture  = 24 * 1024 * 1024
	nodeProjectMaxTextures = 64
)

var (
	nodeProjectIDRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	nodeProjectImgRe  = regexp.MustCompile(`(?i)\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$`)
	nodeProjectDataRe = regexp.MustCompile(`^data:([^;]+);base64,([A-Za-z0-9+/=]+)$`)
)

// NodeProjectMeta 是项目清单里的一条。
type NodeProjectMeta struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	NodeCount    int    `json:"nodeCount"`
	EdgeCount    int    `json:"edgeCount"`
	TextureCount int    `json:"textureCount"`
	HasThumb     bool   `json:"hasThumb"`
	Dir          string `json:"dir"`
}

// NodeProjectTexture 是工程内一张贴图的元信息。
type NodeProjectTexture struct {
	File     string  `json:"file"`
	Name     string  `json:"name"`
	Source   *string `json:"source"`
	FullPath string  `json:"fullPath"`
	Size     int64   `json:"size"`
	Exists   bool    `json:"exists"`
}

// NodeProject 是 GET /api/node-projects/:id 的响应体。
type NodeProject struct {
	ID        string               `json:"id"`
	Name      string               `json:"name"`
	CreatedAt int64                `json:"createdAt"`
	UpdatedAt int64                `json:"updatedAt"`
	Graph     any                  `json:"graph"`
	Textures  []NodeProjectTexture `json:"textures"`
	HasThumb  bool                 `json:"hasThumb"`
	Dir       string               `json:"dir"`
}

// nodeProjectDoc 是 project.json 的结构。
type nodeProjectDoc struct {
	Format   string               `json:"format"`
	Version  int                  `json:"version"`
	Meta     nodeProjectDocMeta   `json:"meta"`
	Graph    any                  `json:"graph"`
	Textures []nodeProjectTexMeta `json:"textures"`
}

type nodeProjectDocMeta struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	NodeCount    int    `json:"nodeCount"`
	EdgeCount    int    `json:"edgeCount"`
	TextureCount int    `json:"textureCount"`
}

type nodeProjectTexMeta struct {
	File   string `json:"file"`
	Name   string `json:"name"`
	Source string `json:"source"`
}

// NodeProjectSaveInput 是保存请求的入参。
type NodeProjectSaveInput struct {
	ID        string
	Name      string
	Graph     map[string]any
	Thumbnail string
	Textures  []NodeProjectSaveTexture
}

// NodeProjectSaveTexture 是待保存的一张贴图：要么是 dataURL（内嵌），
// 要么是绝对路径（从文件复制）。
type NodeProjectSaveTexture struct {
	Name string
	Data string
	Path string
}

// NodeProjectStore 管理节点工程的读写。
type NodeProjectStore struct {
	dir string
	log *slog.Logger
	mu  sync.Mutex
}

// NewNodeProjectStore 创建存储，dataDir 为 <DataRoot>/data。
func NewNodeProjectStore(dataDir string, log *slog.Logger) *NodeProjectStore {
	return &NodeProjectStore{
		dir: filepath.Join(dataDir, "node-projects"),
		log: log,
	}
}

// Dir 返回工程根目录。
func (s *NodeProjectStore) Dir() string { return s.dir }

// ProjectDir 返回单个工程的目录。
func (s *NodeProjectStore) ProjectDir(id string) string {
	return filepath.Join(s.dir, id+".mtgp")
}

func (s *NodeProjectStore) projectFile(id string) string {
	return filepath.Join(s.ProjectDir(id), "project.json")
}

func (s *NodeProjectStore) thumbFile(id string) string {
	return filepath.Join(s.ProjectDir(id), "thumbnail.png")
}

// sanitizeProjectName 清洗工程名，非法返回空串。
func sanitizeProjectName(name string) string {
	if name == "" || !utf8.ValidString(name) {
		return ""
	}
	repl := strings.NewReplacer(
		`\`, "_", "/", "_", ":", "_", "*", "_", "?", "_",
		`"`, "_", "<", "_", ">", "_", "|", "_",
	)
	s := repl.Replace(strings.TrimSpace(name))
	// 折叠连续空白
	s = strings.Join(strings.Fields(s), " ")
	if s == "" || s == "." || s == ".." || utf8.RuneCountInString(s) > NodeProjectMaxName {
		return ""
	}
	return s
}

// safeTextureName 生成工程内贴图文件名：<序号>-<清洗后的名字><扩展名>。
func safeTextureName(name string, i int) string {
	base := ""
	if t := strings.TrimSpace(name); t != "" {
		repl := strings.NewReplacer(
			`\`, "_", "/", "_", ":", "_", "*", "_", "?", "_",
			`"`, "_", "<", "_", ">", "_", "|", "_", " ", "_",
			"\t", "_", "\n", "_", "\r", "_",
		)
		base = repl.Replace(t)
		if utf8.RuneCountInString(base) > 64 {
			base = string([]rune(base)[:64])
		}
	}
	ext := ".png"
	if base != "" && nodeProjectImgRe.MatchString(base) {
		ext = ""
	}
	safe := base
	if safe == "" {
		safe = "texture_" + itoa(i)
	}
	return itoa(i) + "-" + safe + ext
}

// decodeDataURL 解析 data:image/...;base64,xxx，失败返回 nil。
func decodeDataURL(dataURL string, maxBytes int) (mime string, buf []byte) {
	m := nodeProjectDataRe.FindStringSubmatch(dataURL)
	if m == nil {
		return "", nil
	}
	buf, err := base64.StdEncoding.DecodeString(m[2])
	if err != nil || len(buf) == 0 || len(buf) > maxBytes {
		return "", nil
	}
	return m[1], buf
}

// newProjectID 生成工程 id：p<36 进制时间戳><6 位随机 hex>。
func newProjectID() string {
	buf := make([]byte, 3)
	_, _ = rand.Read(buf)
	return "p" + strconv.FormatInt(time.Now().UnixMilli(), 36) + hex.EncodeToString(buf)
}

// Exists 判断工程目录是否存在。
func (s *NodeProjectStore) Exists(id string) bool {
	if !nodeProjectIDRe.MatchString(id) {
		return false
	}
	info, err := os.Stat(s.ProjectDir(id))
	return err == nil && info.IsDir()
}

// readMeta 读取工程元信息，失败返回 nil。
func (s *NodeProjectStore) readMeta(id string) *NodeProjectMeta {
	buf, err := os.ReadFile(s.projectFile(id))
	if err != nil {
		if !os.IsNotExist(err) {
			s.warn("bad project " + id + ": " + err.Error())
		}
		return nil
	}
	var doc nodeProjectDoc
	if err := json.Unmarshal(buf, &doc); err != nil {
		s.warn("bad project " + id + ": " + err.Error())
		return nil
	}
	if doc.Format != NodeProjectFormat || doc.Graph == nil {
		return nil
	}
	nodeCount, edgeCount := graphCounts(doc.Graph)
	name := doc.Meta.Name
	if name == "" {
		name = id
	}
	_, statErr := os.Stat(s.thumbFile(id))
	return &NodeProjectMeta{
		ID:           id,
		Name:         name,
		CreatedAt:    doc.Meta.CreatedAt,
		UpdatedAt:    doc.Meta.UpdatedAt,
		NodeCount:    nodeCount,
		EdgeCount:    edgeCount,
		TextureCount: len(doc.Textures),
		HasThumb:     statErr == nil,
		Dir:          s.ProjectDir(id),
	}
}

// graphCounts 从 graph 里统计节点数与连线数。
func graphCounts(graph any) (nodes, edges int) {
	m, ok := graph.(map[string]any)
	if !ok {
		return 0, 0
	}
	if arr, ok := m["nodes"].([]any); ok {
		nodes = len(arr)
	}
	if arr, ok := m["links"].([]any); ok {
		edges = len(arr)
	} else if arr, ok := m["edges"].([]any); ok {
		edges = len(arr)
	}
	return nodes, edges
}

// List 返回全部工程，按 updatedAt 倒序。
func (s *NodeProjectStore) List() ([]NodeProjectMeta, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return []NodeProjectMeta{}, nil
	}
	out := []NodeProjectMeta{}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasSuffix(e.Name(), ".mtgp") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".mtgp")
		if !nodeProjectIDRe.MatchString(id) {
			continue
		}
		if meta := s.readMeta(id); meta != nil {
			out = append(out, *meta)
		}
		if len(out) >= NodeProjectMaxProjects {
			break
		}
	}
	sortByUpdatedDesc(out)
	return out, nil
}

// sortByUpdatedDesc 按 updatedAt 倒序排序。
func sortByUpdatedDesc(items []NodeProjectMeta) {
	// 插入排序足够：上限 500 条，且实际数量远小于此。
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].UpdatedAt > items[j-1].UpdatedAt; j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

// Save 保存工程，返回工程 id。id 为空表示新建。
func (s *NodeProjectStore) Save(in NodeProjectSaveInput) (string, error) {
	cleanName := sanitizeProjectName(in.Name)
	if cleanName == "" {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid project name")
	}
	if in.Graph == nil {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid graph")
	}
	if _, ok := in.Graph["nodes"].([]any); !ok {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid graph")
	}

	isUpdate := in.ID != ""
	if isUpdate && !nodeProjectIDRe.MatchString(in.ID) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid project id")
	}
	if isUpdate && !s.Exists(in.ID) {
		return "", httpx.Errorf(httpx.CodeNotFound, "project not found")
	}

	finalID := in.ID
	if !isUpdate {
		finalID = newProjectID()
	}
	dir := s.ProjectDir(finalID)
	texDir := filepath.Join(dir, "textures")

	var prevCreated int64
	if isUpdate {
		if prev := s.readMeta(finalID); prev != nil {
			prevCreated = prev.CreatedAt
		}
	}
	now := time.Now().UnixMilli()
	if prevCreated == 0 {
		prevCreated = now
	}

	// 组装贴图：内嵌的直接解码，路径的读入内存（避免删目录后源文件消失）。
	type pending struct {
		name string
		buf  []byte
	}
	var pendings []pending
	for _, t := range in.Textures {
		if len(pendings) >= nodeProjectMaxTextures {
			break
		}
		if t.Data != "" {
			if _, buf := decodeDataURL(t.Data, NodeProjectMaxTexture); buf != nil {
				pendings = append(pendings, pending{name: t.Name, buf: buf})
			}
			continue
		}
		if t.Path != "" && filepath.IsAbs(filepath.Clean(t.Path)) {
			buf, err := os.ReadFile(filepath.Clean(t.Path))
			if err != nil {
				s.warn("read texture failed: " + err.Error())
				continue
			}
			pendings = append(pendings, pending{name: t.Name, buf: buf})
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_ = os.RemoveAll(texDir)
	if err := os.MkdirAll(texDir, 0o755); err != nil {
		return "", err
	}

	texMeta := make([]nodeProjectTexMeta, 0, len(pendings))
	for i, p := range pendings {
		file := safeTextureName(p.name, i)
		if err := os.WriteFile(filepath.Join(texDir, file), p.buf, 0o644); err != nil {
			s.warn("write texture failed: " + err.Error())
			continue
		}
		name := p.name
		if name == "" {
			name = file
		}
		texMeta = append(texMeta, nodeProjectTexMeta{File: file, Name: name, Source: "embedded"})
	}

	if in.Thumbnail != "" {
		if _, buf := decodeDataURL(in.Thumbnail, NodeProjectMaxThumb); buf != nil {
			if err := os.WriteFile(s.thumbFile(finalID), buf, 0o644); err != nil {
				s.warn("write thumbnail failed: " + err.Error())
			}
		}
	}

	nodeCount, edgeCount := graphCounts(in.Graph)
	doc := nodeProjectDoc{
		Format:  NodeProjectFormat,
		Version: NodeProjectVersion,
		Meta: nodeProjectDocMeta{
			ID: finalID, Name: cleanName,
			CreatedAt: prevCreated, UpdatedAt: now,
			NodeCount: nodeCount, EdgeCount: edgeCount, TextureCount: len(texMeta),
		},
		Graph:    in.Graph,
		Textures: texMeta,
	}
	if err := AtomicWriteJSON(s.projectFile(finalID), doc); err != nil {
		return "", err
	}
	return finalID, nil
}

// Load 读取一个工程。
func (s *NodeProjectStore) Load(id string) (*NodeProject, error) {
	if !nodeProjectIDRe.MatchString(id) || !s.Exists(id) {
		return nil, httpx.Errorf(httpx.CodeNotFound, "project not found")
	}
	buf, err := os.ReadFile(s.projectFile(id))
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeUnknown, "bad project file: "+err.Error())
	}
	var doc nodeProjectDoc
	if err := json.Unmarshal(buf, &doc); err != nil {
		return nil, httpx.Errorf(httpx.CodeUnknown, "bad project file: "+err.Error())
	}
	if doc.Format != NodeProjectFormat || doc.Graph == nil {
		return nil, httpx.Errorf(httpx.CodeUnknown, "bad project file")
	}
	texDir := filepath.Join(s.ProjectDir(id), "textures")
	textures := []NodeProjectTexture{}
	for _, t := range doc.Textures {
		if t.File == "" {
			continue
		}
		fullPath := filepath.Join(texDir, t.File)
		var size int64
		if info, err := os.Stat(fullPath); err == nil {
			size = info.Size()
		}
		var source *string
		if t.Source != "" {
			src := t.Source
			source = &src
		}
		name := t.Name
		if name == "" {
			name = t.File
		}
		textures = append(textures, NodeProjectTexture{
			File: t.File, Name: name, Source: source,
			FullPath: fullPath, Size: size, Exists: size > 0,
		})
	}
	name := doc.Meta.Name
	if name == "" {
		name = id
	}
	_, statErr := os.Stat(s.thumbFile(id))
	return &NodeProject{
		ID: id, Name: name,
		CreatedAt: doc.Meta.CreatedAt, UpdatedAt: doc.Meta.UpdatedAt,
		Graph: doc.Graph, Textures: textures,
		HasThumb: statErr == nil, Dir: s.ProjectDir(id),
	}, nil
}

// Remove 删除一个工程。
func (s *NodeProjectStore) Remove(id string) error {
	if !nodeProjectIDRe.MatchString(id) || !s.Exists(id) {
		return httpx.Errorf(httpx.CodeNotFound, "project not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.RemoveAll(s.ProjectDir(id))
}

// Rename 重命名工程。
func (s *NodeProjectStore) Rename(id, name string) (string, error) {
	cleanName := sanitizeProjectName(name)
	if cleanName == "" {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid project name")
	}
	if _, err := s.Load(id); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	buf, err := os.ReadFile(s.projectFile(id))
	if err != nil {
		return "", err
	}
	var raw map[string]any
	if err := json.Unmarshal(buf, &raw); err != nil {
		return "", err
	}
	meta, _ := raw["meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	meta["name"] = cleanName
	meta["updatedAt"] = time.Now().UnixMilli()
	raw["meta"] = meta
	if err := AtomicWriteJSON(s.projectFile(id), raw); err != nil {
		return "", err
	}
	return cleanName, nil
}

// ThumbPath 返回缩略图路径。
func (s *NodeProjectStore) ThumbPath(id string) string {
	return s.thumbFile(id)
}

func (s *NodeProjectStore) warn(msg string) {
	if s.log != nil {
		s.log.Warn("node-projects: " + msg)
	}
}
