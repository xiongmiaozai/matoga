// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package craftpack

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/mcmeta"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// 常量（与 Node 版 craft-pack-service.js 一致）。
const (
	MarkerFile        = "matoga-craft.json"
	MarkerFormat      = "matoga-craft-pack"
	MarkerVersion     = 1
	MaxItems          = 500
	MaxExportItems    = 2000
	MaxFileBytes      = 256 * 1024 * 1024
	DefaultName       = "我的制作包"
	DefaultPackFormat = 64
)

// 允许的扩展名集合。
var (
	imgExts   = map[string]bool{"png": true, "jpg": true, "jpeg": true, "webp": true, "gif": true, "bmp": true, "tga": true, "tif": true, "tiff": true}
	modelExts = map[string]bool{"json": true, "bbmodel": true}
	hdriExts  = map[string]bool{"hdr": true, "exr": true}
)

// packRelRe 校验包内相对路径形如 assets/<ns>/textures|models/…。
var packRelRe = regexp.MustCompile(`^assets/[^/]+/(textures|models)/[^/].*$`)

// assetsModelRe 从磁盘绝对路径中截出 assets/<ns>/models/… 结构。
var assetsModelRe = regexp.MustCompile(`[\\/]?(assets[\\/][^\\/]+[\\/]models[\\/].+)$`)

// Item 是自选清单条目（比 store.AssetItem 多 craftPath）。
type Item struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	Thumb     *string `json:"thumb"`
	Type      string  `json:"type"`
	Path      *string `json:"path"`
	CraftPath string  `json:"craftPath,omitempty"`
	Mtime     float64 `json:"mtime"`
	Role      string  `json:"role,omitempty"`
	Color     string  `json:"color,omitempty"`
	Badge     string  `json:"badge,omitempty"`
}

// Service 管理自选清单与制作包。
type Service struct {
	dir     string
	selFile string
	assets  *store.AssetStore
	config  *store.Config
	mu      sync.Mutex
}

// New 创建服务。
func New(dataRoot string, assets *store.AssetStore, config *store.Config) *Service {
	dir := filepath.Join(dataRoot, "data", "craft-pack")
	return &Service{
		dir:     dir,
		selFile: filepath.Join(dir, "selection.json"),
		assets:  assets,
		config:  config,
	}
}

// Dir 返回持久化目录。
func (s *Service) Dir() string { return s.dir }

// sanitizeItem 与 Node 版 sanitizeItem 等价。
func sanitizeItem(it map[string]any) *Item {
	if it == nil {
		return nil
	}
	key, _ := it["key"].(string)
	if key == "" {
		return nil
	}
	detected := store.DetectType(key)
	if detected == "" {
		return nil
	}
	t, _ := it["type"].(string)
	if t != "" && !store.ValidType(t) {
		return nil
	}
	typ := t
	if typ == "" {
		typ = detected
	}
	if typ != detected {
		return nil
	}
	out := &Item{Key: key, Type: typ}
	if v, ok := it["name"].(string); ok {
		out.Name = v
	}
	if v, ok := it["thumb"].(string); ok {
		out.Thumb = &v
	}
	if v, ok := it["path"].(string); ok {
		out.Path = &v
	}
	if v, ok := it["craftPath"].(string); ok {
		out.CraftPath = v
	}
	if v, ok := it["mtime"].(float64); ok {
		out.Mtime = v
	}
	if v, ok := it["role"].(string); ok {
		out.Role = v
	}
	if v, ok := it["color"].(string); ok {
		out.Color = v
	}
	if v, ok := it["badge"].(string); ok {
		out.Badge = v
	}
	return out
}

// sanitizeList 去重并截断。
func sanitizeList(arr []any, max int) []Item {
	out := make([]Item, 0, len(arr))
	seen := make(map[string]bool, len(arr))
	for _, x := range arr {
		m, ok := x.(map[string]any)
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

// readSelectionRaw 读 selection.json，失败返回空。
func (s *Service) readSelectionRaw() map[string]any {
	b, err := os.ReadFile(s.selFile)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return map[string]any{}
	}
	return m
}

// Selection 返回自选清单。
func (s *Service) Selection() []Item {
	raw := s.readSelectionRaw()
	arr, _ := raw["items"].([]any)
	return sanitizeList(arr, MaxItems)
}

// writeSelection 原子写入自选清单（调用方持锁）。
func (s *Service) writeSelection(items []Item) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	if err := store.AtomicWriteJSON(s.selFile, map[string]any{"items": items}); err != nil {
		return httpx.Errorf(httpx.CodeFS, err.Error())
	}
	return nil
}

// SetSelection 覆盖保存自选清单。
func (s *Service) SetSelection(items []any) ([]Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	clean := sanitizeList(items, MaxItems)
	if err := s.writeSelection(clean); err != nil {
		return nil, err
	}
	return clean, nil
}

// AddItem 追加条目（按 key 去重）。
func (s *Service) AddItem(it map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur := s.Selection()
	item := sanitizeItem(it)
	if item == nil {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid craft item")
	}
	for _, x := range cur {
		if x.Key == item.Key {
			return map[string]any{"added": false, "count": len(cur)}, nil
		}
	}
	if len(cur) >= MaxItems {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "craft pack full: "+strconv.Itoa(MaxItems))
	}
	cur = append(cur, *item)
	if err := s.writeSelection(cur); err != nil {
		return nil, err
	}
	return map[string]any{"added": true, "count": len(cur)}, nil
}

// RemoveItem 按 key 移除。
func (s *Service) RemoveItem(key string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur := s.Selection()
	next := make([]Item, 0, len(cur))
	for _, x := range cur {
		if x.Key != key {
			next = append(next, x)
		}
	}
	if len(next) == len(cur) {
		return map[string]any{"removed": false, "count": len(cur)}, nil
	}
	if err := s.writeSelection(next); err != nil {
		return nil, err
	}
	return map[string]any{"removed": true, "count": len(next)}, nil
}

// ClearSelection 清空自选清单。
func (s *Service) ClearSelection() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writeSelection([]Item{}); err != nil {
		return nil, err
	}
	return map[string]any{"cleared": true, "count": 0}, nil
}

// cfgPaths 从配置里取四个路径。
type cfgPaths struct {
	mcPacks       string
	officialPacks string
	craftPacks    string
}

func (s *Service) paths() cfgPaths {
	c := s.config.Get()
	str := func(k string) string {
		v, _ := c[k].(string)
		return v
	}
	return cfgPaths{
		mcPacks:       str("mcPacksPath"),
		officialPacks: str("officialPacksPath"),
		craftPacks:    str("craftPacksPath"),
	}
}

// aggregateStorage 聚合自选 + 收藏 + 最近（key 去重，前者优先）。
func (s *Service) aggregateStorage() ([]Item, map[string]int) {
	sel := s.Selection()
	fav := s.assets.Favorites()
	rec := s.assets.Recent()

	seen := make(map[string]bool, len(sel)+len(fav)+len(rec))
	out := make([]Item, 0, len(sel)+len(fav)+len(rec))
	add := func(it Item) {
		if seen[it.Key] {
			return
		}
		seen[it.Key] = true
		out = append(out, it)
	}
	for _, x := range sel {
		add(x)
	}
	for _, x := range fav {
		add(Item{Key: x.Key, Name: x.Name, Thumb: x.Thumb, Type: x.Type, Path: x.Path, Mtime: x.Mtime, Role: x.Role, Color: x.Color, Badge: x.Badge})
	}
	for _, x := range rec {
		add(Item{Key: x.Key, Name: x.Name, Thumb: x.Thumb, Type: x.Type, Path: x.Path, Mtime: x.Mtime, Role: x.Role, Color: x.Color, Badge: x.Badge})
	}
	if len(out) > MaxExportItems {
		out = out[:MaxExportItems]
	}
	totals := map[string]int{
		"selection": len(sel), "favorites": len(fav), "recent": len(rec), "aggregate": len(out),
	}
	return out, totals
}

// packRef 是解析出的包内引用。
type packRef struct {
	source   string
	packName string
	rel      string
}

// parsePackRef 解析 pack:mc:<包>/<rel> 形式的引用。
func parsePackRef(p, prefix string) *packRef {
	if !strings.HasPrefix(p, prefix) {
		return nil
	}
	rest := p[len(prefix):]
	ci := strings.Index(rest, ":")
	if ci <= 0 {
		return nil
	}
	source := rest[:ci]
	remain := rest[ci+1:]
	si := strings.Index(remain, "/")
	if si <= 0 {
		return nil
	}
	return &packRef{source: source, packName: remain[:si], rel: remain[si+1:]}
}

// rootForSource 把来源映射到包根目录。
func (s *Service) rootForSource(source string) string {
	p := s.paths()
	switch source {
	case "mc":
		return p.mcPacks
	case "official":
		return p.officialPacks
	case "craft":
		return p.craftPacks
	}
	return ""
}

// extOf 取小写扩展名。
func extOf(name string) string {
	i := strings.LastIndex(name, ".")
	if i < 0 {
		return ""
	}
	return strings.ToLower(name[i+1:])
}

// safePackRel 校验包内相对路径。
func safePackRel(rel string) string {
	if rel == "" || !packRelRe.MatchString(rel) {
		return ""
	}
	if strings.Contains(rel, "..") || strings.Contains(rel, `\`) || strings.ContainsRune(rel, 0) {
		return ""
	}
	return rel
}

// readDiskFile 读磁盘文件，校验扩展名与大小。
func readDiskFile(p string, allowed map[string]bool) []byte {
	abs, err := fsx.GuardRead(p)
	if err != nil {
		return nil
	}
	if !allowed[extOf(abs)] {
		return nil
	}
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() || st.Size() > MaxFileBytes {
		return nil
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil
	}
	return b
}

// resolveResult 是解析结果：要么有 dest+bytes，要么有 skip 原因。
type resolveResult struct {
	dest  string
	bytes []byte
	skip  string
}

// normalizeAssetsRel 从磁盘路径里截出 assets/<ns>/models/… 结构。
func normalizeAssetsRel(abs string) string {
	m := assetsModelRe.FindStringSubmatch(abs)
	if m == nil {
		return ""
	}
	return strings.ReplaceAll(m[1], `\`, "/")
}

// resolveEntry 把条目解析成「目标相对路径 + 字节」。
func (s *Service) resolveEntry(item Item) resolveResult {
	p := ""
	if item.Path != nil {
		p = *item.Path
	}
	if p == "" {
		return resolveResult{skip: "virtual or pack-media asset"}
	}

	// 贴图：包内虚拟路径 → 保留原包内结构
	if item.Type == "tex" {
		if pt := parsePackRef(p, "pack:"); pt != nil {
			root := s.rootForSource(pt.source)
			rel := safePackRel(pt.rel)
			if root == "" || rel == "" {
				return resolveResult{skip: "invalid pack path"}
			}
			pf, err := mcmeta.ReadPackFile(root, pt.packName, pt.rel, false)
			if err != nil {
				return resolveResult{skip: err.Error()}
			}
			return resolveResult{dest: rel, bytes: pf.Buf}
		}
	}

	// 模型：包内虚拟路径
	if item.Type == "model" {
		if pm := parsePackRef(p, "packmodel:"); pm != nil {
			root := s.rootForSource(pm.source)
			rel := safePackRel(pm.rel)
			if root == "" || rel == "" {
				return resolveResult{skip: "invalid pack path"}
			}
			pf, err := mcmeta.ReadPackFile(root, pm.packName, pm.rel, true)
			if err != nil {
				return resolveResult{skip: err.Error()}
			}
			return resolveResult{dest: rel, bytes: pf.Buf}
		}
	}

	isAbs := filepath.IsAbs(p)

	// 贴图：磁盘绝对路径 → assets/matoga/textures/<文件名>
	if item.Type == "tex" && isAbs {
		buf := readDiskFile(p, imgExts)
		if buf == nil {
			return resolveResult{skip: "texture file missing or unsupported"}
		}
		return resolveResult{dest: "assets/matoga/textures/" + filepath.Base(p), bytes: buf}
	}

	// 模型：磁盘 .json → assets/matoga/models/<文件名>（有 assets 结构则保留）
	if item.Type == "model" && isAbs {
		buf := readDiskFile(p, modelExts)
		if buf == nil {
			return resolveResult{skip: "model file missing or unsupported"}
		}
		rel := safePackRel(normalizeAssetsRel(p))
		if rel == "" {
			rel = "assets/matoga/models/" + filepath.Base(p)
		}
		return resolveResult{dest: rel, bytes: buf}
	}

	// HDRI：磁盘路径 → hdri/<文件名>
	if item.Type == "hdri" && isAbs {
		buf := readDiskFile(p, hdriExts)
		if buf == nil {
			return resolveResult{skip: "hdri file missing or unsupported"}
		}
		return resolveResult{dest: "hdri/" + filepath.Base(p), bytes: buf}
	}

	return resolveResult{skip: "virtual or pack-media asset"}
}

// LocatePath 返回条目可在文件管理器中打开的磁盘路径（仅响应，不落盘）。
func (s *Service) LocatePath(item Item) *string {
	if item.CraftPath != "" {
		if st, err := os.Stat(item.CraftPath); err == nil && !st.IsDir() {
			return &item.CraftPath
		}
	}
	if item.Path == nil || *item.Path == "" {
		return nil
	}
	p := *item.Path
	if filepath.IsAbs(p) {
		return &p
	}
	for _, prefix := range []string{"pack:", "packmodel:"} {
		ref := parsePackRef(p, prefix)
		if ref == nil {
			continue
		}
		root := s.rootForSource(ref.source)
		if root == "" {
			continue
		}
		full := filepath.Join(root, ref.packName, filepath.FromSlash(ref.rel))
		return &full
	}
	return nil
}

// ensureCraftPackDir 确保当前制作包目录存在并带 pack.mcmeta。
func (s *Service) ensureCraftPackDir() (string, error) {
	root := s.paths().craftPacks
	if root == "" {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "craftPacksPath not configured")
	}
	packDir := filepath.Join(root, DefaultName)
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		return "", httpx.Errorf(httpx.CodeFS, err.Error())
	}
	mcmetaPath := filepath.Join(packDir, "pack.mcmeta")
	if _, err := os.Stat(mcmetaPath); err != nil {
		body := map[string]any{
			"pack": map[string]any{
				"pack_format": DefaultPackFormat,
				"description": DefaultName + " · matoga",
			},
		}
		if err := store.AtomicWriteJSON(mcmetaPath, body); err != nil {
			return "", httpx.Errorf(httpx.CodeFS, err.Error())
		}
	}
	return packDir, nil
}

// uniqueDest 目标已存在时加 -2、-3 序号。
func uniqueDest(packDir, dest string) string {
	if _, err := os.Stat(filepath.Join(packDir, filepath.FromSlash(dest))); err != nil {
		return dest
	}
	dot := strings.LastIndex(dest, ".")
	ext, stem := "", dest
	if dot > 0 {
		ext = dest[dot:]
		stem = dest[:dot]
	}
	for i := 2; ; i++ {
		cand := stem + "-" + strconv.Itoa(i) + ext
		if _, err := os.Stat(filepath.Join(packDir, filepath.FromSlash(cand))); err != nil {
			return cand
		}
	}
}

// CopyToCraftPack 把单个资产或整包复制进当前制作包目录。
func (s *Service) CopyToCraftPack(it map[string]any) (map[string]any, error) {
	item := sanitizeItem(it)
	if item == nil {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid craft item")
	}
	packDir, err := s.ensureCraftPackDir()
	if err != nil {
		return nil, err
	}

	// 整包（mc/official）：合并复制包内 assets/
	if item.Type == "mc" || item.Type == "official" {
		return s.copyWholePack(*item, packDir)
	}

	r := s.resolveEntry(*item)
	if r.skip != "" {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "cannot copy asset: "+r.skip)
	}
	dest := uniqueDest(packDir, r.dest)
	full := filepath.Join(packDir, filepath.FromSlash(dest))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	if err := os.WriteFile(full, r.bytes, 0o644); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}

	item.CraftPath = full
	m := itemToMap(*item)
	if _, err := s.AddItem(m); err != nil {
		return nil, err
	}
	return map[string]any{"name": DefaultName, "dir": packDir, "dest": dest, "written": 1}, nil
}

// itemToMap 把 Item 转回 map（供 AddItem 复用校验）。
func itemToMap(it Item) map[string]any {
	m := map[string]any{
		"key": it.Key, "name": it.Name, "type": it.Type, "mtime": it.Mtime,
	}
	if it.Thumb != nil {
		m["thumb"] = *it.Thumb
	}
	if it.Path != nil {
		m["path"] = *it.Path
	}
	if it.CraftPath != "" {
		m["craftPath"] = it.CraftPath
	}
	if it.Role != "" {
		m["role"] = it.Role
	}
	if it.Color != "" {
		m["color"] = it.Color
	}
	if it.Badge != "" {
		m["badge"] = it.Badge
	}
	return m
}

// copyWholePack 合并复制整包的 assets/ 到制作包。
func (s *Service) copyWholePack(item Item, packDir string) (map[string]any, error) {
	if item.Path == nil || !filepath.IsAbs(*item.Path) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid pack path")
	}
	srcDir := *item.Path
	st, err := os.Stat(srcDir)
	if err != nil || !st.IsDir() {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "pack is not a directory (zip not supported): "+srcDir)
	}
	srcAssets := filepath.Join(srcDir, "assets")
	if st, err := os.Stat(srcAssets); err != nil || !st.IsDir() {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "pack has no assets/ directory: "+srcDir)
	}

	rels := make([]string, 0, 256)
	var walk func(abs, relBase string)
	walk = func(abs, relBase string) {
		ents, err := os.ReadDir(abs)
		if err != nil {
			return
		}
		for _, e := range ents {
			if strings.HasPrefix(e.Name(), ".") {
				continue
			}
			rel := e.Name()
			if relBase != "" {
				rel = relBase + "/" + e.Name()
			}
			if e.IsDir() {
				walk(filepath.Join(abs, e.Name()), rel)
			} else {
				rels = append(rels, rel)
			}
		}
	}
	walk(srcAssets, "")
	if len(rels) == 0 {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "pack assets/ is empty: "+srcDir)
	}

	copied := 0
	for _, rel := range rels {
		dest := uniqueDest(packDir, "assets/"+rel)
		full := filepath.Join(packDir, filepath.FromSlash(dest))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			continue
		}
		src := filepath.Join(srcAssets, filepath.FromSlash(rel))
		if b, err := os.ReadFile(src); err == nil {
			if os.WriteFile(full, b, 0o644) == nil {
				copied++
			}
		}
	}

	if _, err := s.AddItem(itemToMap(item)); err != nil {
		return nil, err
	}
	return map[string]any{
		"name": DefaultName, "dir": packDir, "written": copied, "wholePack": true,
	}, nil
}

// stamp 返回 yyyyMMdd-HHmmss 形式的快照时间戳。
func stamp() string {
	return time.Now().Format("20060102-150405")
}

// uniquePackName 在 root 下找一个未被占用的包目录名。
func uniquePackName(root, name string) (string, error) {
	cand := name
	for i := 2; i < 100; i++ {
		if _, err := os.Stat(filepath.Join(root, cand)); err != nil {
			return cand, nil
		}
		cand = name + "-" + strconv.Itoa(i)
	}
	return "", httpx.Errorf(httpx.CodeFS, "cannot allocate pack dir name")
}

// ExportOptions 是导出参数。
type ExportOptions struct {
	Name        string
	Description string
	PackFormat  float64
	HasFormat   bool
	Items       []any
	HasItems    bool
}

// Export 聚合全部储存并导出为真实 MC 资源包。
func (s *Service) Export(opts ExportOptions) (map[string]any, error) {
	root := s.paths().craftPacks
	if root == "" {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "craftPacksPath not configured")
	}

	name := strings.TrimSpace(opts.Name)
	if name == "" {
		name = DefaultName
	}
	if !mcmeta.ValidPackName(name) {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid pack name")
	}
	if name == DefaultName {
		name = DefaultName + "-" + stamp()
	}

	packFormat := DefaultPackFormat
	if opts.HasFormat && opts.PackFormat > 0 {
		packFormat = int(opts.PackFormat)
	}
	desc := strings.TrimSpace(opts.Description)
	if desc == "" {
		desc = name + " · matoga"
	}

	var items []Item
	var totals map[string]any
	if opts.HasItems {
		items = sanitizeList(opts.Items, MaxExportItems)
		totals = map[string]any{"custom": true}
	} else {
		var t map[string]int
		items, t = s.aggregateStorage()
		totals = map[string]any{
			"selection": t["selection"], "favorites": t["favorites"],
			"recent": t["recent"], "aggregate": t["aggregate"],
		}
	}
	if len(items) == 0 {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "no stored assets to export")
	}

	dirName, err := uniquePackName(root, name)
	if err != nil {
		return nil, err
	}
	packDir := filepath.Join(root, dirName)
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}

	written := make([]map[string]any, 0, len(items))
	skipped := make([]map[string]any, 0)
	usedDest := make(map[string]bool, len(items))

	for _, it := range items {
		r := s.resolveEntry(it)
		if r.skip != "" {
			skipped = append(skipped, map[string]any{
				"key": it.Key, "name": it.Name, "type": it.Type, "reason": r.skip,
			})
			continue
		}
		dest := r.dest
		if usedDest[dest] {
			dot := strings.LastIndex(dest, ".")
			ext, stem := "", dest
			if dot > 0 {
				ext = dest[dot:]
				stem = dest[:dot]
			}
			for i := 2; ; i++ {
				cand := stem + "-" + strconv.Itoa(i) + ext
				if !usedDest[cand] {
					dest = cand
					break
				}
			}
		}
		usedDest[dest] = true
		full := filepath.Join(packDir, filepath.FromSlash(dest))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			skipped = append(skipped, map[string]any{
				"key": it.Key, "name": it.Name, "type": it.Type, "reason": err.Error(),
			})
			continue
		}
		if err := os.WriteFile(full, r.bytes, 0o644); err != nil {
			skipped = append(skipped, map[string]any{
				"key": it.Key, "name": it.Name, "type": it.Type, "reason": err.Error(),
			})
			continue
		}
		written = append(written, map[string]any{
			"key": it.Key, "name": it.Name, "type": it.Type, "dest": dest,
		})
	}

	mcmetaBody := map[string]any{
		"pack": map[string]any{"pack_format": packFormat, "description": desc},
	}
	if err := store.AtomicWriteJSON(filepath.Join(packDir, "pack.mcmeta"), mcmetaBody); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}

	marker := map[string]any{
		"format":     MarkerFormat,
		"version":    MarkerVersion,
		"exportedAt": time.Now().UnixMilli(),
		"name":       dirName,
		"packFormat": packFormat,
		"totals":     totals,
		"written":    written,
		"skipped":    skipped,
	}
	if err := store.AtomicWriteJSON(filepath.Join(packDir, MarkerFile), marker); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}

	return map[string]any{
		"name": dirName, "dir": packDir, "packFormat": packFormat,
		"written": len(written), "skipped": len(skipped),
		"skippedList": skipped, "totals": totals,
	}, nil
}

// scanCraftRoot 扫 root 下含 matoga-craft.json 的包。
func scanCraftRoot(root string) []map[string]any {
	if root == "" {
		return nil
	}
	ents, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	packs := make([]map[string]any, 0, len(ents))
	for _, e := range ents {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(root, e.Name(), MarkerFile))
		if err != nil {
			continue
		}
		var raw map[string]any
		if json.Unmarshal(b, &raw) != nil {
			continue
		}
		if f, _ := raw["format"].(string); f != MarkerFormat {
			continue
		}
		name, _ := raw["name"].(string)
		if name == "" {
			name = e.Name()
		}
		exportedAt, _ := raw["exportedAt"].(float64)
		writtenN, skippedN := 0, 0
		if w, ok := raw["written"].([]any); ok {
			writtenN = len(w)
		}
		if sk, ok := raw["skipped"].([]any); ok {
			skippedN = len(sk)
		}
		packs = append(packs, map[string]any{
			"name":       name,
			"dir":        filepath.Join(root, e.Name()),
			"exportedAt": int64(exportedAt),
			"packFormat": raw["packFormat"],
			"written":    writtenN,
			"skipped":    skippedN,
			"totals":     raw["totals"],
		})
	}
	return packs
}

// ListPacks 列出已导出制作包（主目录 + mcPacksPath 兼容）。
func (s *Service) ListPacks() map[string]any {
	p := s.paths()
	seen := make(map[string]bool, 16)
	packs := make([]map[string]any, 0, 16)
	for _, root := range []string{p.craftPacks, p.mcPacks} {
		for _, x := range scanCraftRoot(root) {
			dir, _ := x["dir"].(string)
			if seen[dir] {
				continue
			}
			seen[dir] = true
			packs = append(packs, x)
		}
	}
	sort.SliceStable(packs, func(i, j int) bool {
		a, _ := packs[i]["exportedAt"].(int64)
		b, _ := packs[j]["exportedAt"].(int64)
		return a > b
	})
	return map[string]any{"packs": packs}
}

// Current 返回当前制作包项目（craft-packs/我的制作包/）。
func (s *Service) Current() map[string]any {
	root := s.paths().craftPacks
	if root == "" {
		return map[string]any{"pack": nil}
	}
	packDir := filepath.Join(root, DefaultName)
	if st, err := os.Stat(packDir); err != nil || !st.IsDir() {
		return map[string]any{"pack": nil}
	}

	fileCount := 0
	var walk func(dir string)
	walk = func(dir string) {
		ents, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range ents {
			if strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if e.IsDir() {
				walk(filepath.Join(dir, e.Name()))
			} else {
				fileCount++
			}
		}
	}
	if st, err := os.Stat(filepath.Join(packDir, "assets")); err == nil && st.IsDir() {
		walk(filepath.Join(packDir, "assets"))
	}

	var packFormat any
	if b, err := os.ReadFile(filepath.Join(packDir, "pack.mcmeta")); err == nil {
		var m map[string]any
		if json.Unmarshal(b, &m) == nil {
			if pk, ok := m["pack"].(map[string]any); ok {
				packFormat = pk["pack_format"]
			}
		}
	}
	return map[string]any{
		"pack": map[string]any{
			"name": DefaultName, "dir": packDir,
			"packFormat": packFormat, "fileCount": fileCount,
		},
	}
}

// SelectionWithLocate 返回自选清单，并附加 locatePath（仅响应）。
func (s *Service) SelectionWithLocate() []map[string]any {
	items := s.Selection()
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		m := itemToMap(it)
		if lp := s.LocatePath(it); lp != nil {
			m["locatePath"] = *lp
		} else {
			m["locatePath"] = nil
		}
		out = append(out, m)
	}
	return out
}
