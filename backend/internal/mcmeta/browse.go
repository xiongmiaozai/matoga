// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"archive/zip"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// 分页与浏览上限，与 Node 版一致。
const (
	TexPageDefault   = 120
	TexPageMax       = 400
	BrowseMaxEntries = 4000
)

// parseTexPath 解析 assets/<ns>/textures/<rest>，已在 mcmeta.go 定义。

// assertBrowseDir 校验贴图浏览目录：null/”（根）或 assets/<ns>[/textures[/子目录…]]。
func assertBrowseDir(dir string) (string, error) {
	if dir == "" {
		return "", nil
	}
	if strings.HasPrefix(dir, "/") || strings.HasSuffix(dir, "/") ||
		strings.Contains(dir, `\`) || strings.Contains(dir, "..") ||
		strings.ContainsRune(dir, 0) {
		return "", fmt.Errorf("invalid browse dir")
	}
	segs := strings.Split(dir, "/")
	if len(segs) < 2 || segs[0] != "assets" || segs[1] == "" {
		return "", fmt.Errorf("invalid browse dir: must be under assets/<ns>/textures")
	}
	if len(segs) == 2 {
		return "", nil // assets/<ns> 本身不是浏览层
	}
	if segs[2] != "textures" {
		return "", fmt.Errorf("invalid browse dir: must be under assets/<ns>/textures")
	}
	return dir, nil
}

// parentBrowseDir 求上级浏览目录，assets/<ns>/textures 的上级回根。
func parentBrowseDir(dir string) *string {
	segs := strings.Split(dir, "/")
	up := strings.Join(segs[:len(segs)-1], "/")
	// assets/<ns>/textures → 根
	if len(segs) == 3 && segs[0] == "assets" && segs[2] == "textures" {
		return nil
	}
	return &up
}

// TexCategory 是贴图类别（textures/ 第一级目录）。
type TexCategory struct {
	Name  string `json:"name"`
	Dir   string `json:"dir"`
	Count int    `json:"count"`
}

// BrowseDir 是浏览视图中的子目录。
type BrowseDir struct {
	Name  string `json:"name"`
	Dir   string `json:"dir"`
	Count int    `json:"count"`
}

// BrowseFile 是浏览视图中的文件。
type BrowseFile struct {
	Path  string  `json:"path,omitempty"`
	Name  string  `json:"name"`
	Size  int64   `json:"size"`
	Mtime float64 `json:"mtime,omitempty"`
}

// Breadcrumb 是面包屑节点。
type Breadcrumb struct {
	Name string  `json:"name"`
	Dir  *string `json:"dir"`
}

// PackTextures 是 listPackTextures 的返回。
type PackTextures struct {
	Name        string        `json:"name"`
	Kind        string        `json:"kind"`
	Dir         string        `json:"dir"`
	Parent      *string       `json:"parent"`
	Namespaces  []string      `json:"namespaces"`
	Categories  []TexCategory `json:"categories"`
	Dirs        []BrowseDir   `json:"dirs"`
	Breadcrumbs []Breadcrumb  `json:"breadcrumbs"`
	Files       []BrowseFile  `json:"files"`
	FilesTotal  int           `json:"filesTotal"`
	Total       int           `json:"total"`
	Offset      int           `json:"offset"`
	Limit       int           `json:"limit"`
}

// statPack 校验包名并 stat 包路径。
func statPack(root, name string) (os.FileInfo, string, error) {
	if !ValidPackName(name) {
		return nil, "", fmt.Errorf("invalid pack name")
	}
	full := filepath.Join(root, name)
	st, err := os.Stat(full)
	if err != nil {
		return nil, "", fmt.Errorf("pack not found: %s", name)
	}
	return st, full, nil
}

// packTextures 收集包内全部贴图。
func packTextures(st os.FileInfo, full string) (kind, packRoot string, texs []TexFile, err error) {
	kind = "dir"
	if st.IsDir() {
		packRoot = ResolveDirPack(full)
		if packRoot == "" {
			packRoot = full
		}
		texs = walkDirTextures(packRoot)
		return kind, packRoot, texs, nil
	}
	kind = "zip"
	files, err := readZipEntries(full)
	if err != nil {
		return kind, "", nil, err
	}
	return kind, "", zipTextureEntries(files), nil
}

// ListPackTextures 列出包内贴图（分类 + 目录浏览 + 分页）。
func ListPackTextures(root, name, dir, offsetStr, limitStr string) (*PackTextures, error) {
	st, full, err := statPack(root, name)
	if err != nil {
		return nil, err
	}
	kind, _, texs, err := packTextures(st, full)
	if err != nil {
		return nil, err
	}
	total := len(texs)

	browseDir, err := assertBrowseDir(dir)
	if err != nil {
		return nil, err
	}
	offset := 0
	if n, e := strconv.Atoi(offsetStr); e == nil && n > 0 {
		offset = n
	}
	limit := TexPageDefault
	if n, e := strconv.Atoi(limitStr); e == nil && n > 0 {
		limit = n
	}
	if limit > TexPageMax {
		limit = TexPageMax
	}

	// 命名空间与类别
	nsSeen := make(map[string]bool, 8)
	namespaces := make([]string, 0, 8)
	catMap := make(map[string]*TexCategory, 16)
	for _, t := range texs {
		ns, rest, ok := parseTexPath(t.Path)
		if !ok {
			continue
		}
		if !nsSeen[ns] {
			nsSeen[ns] = true
			namespaces = append(namespaces, ns)
		}
		seg := strings.Split(rest, "/")
		if len(seg) >= 2 {
			key := ns + "/" + seg[0]
			c := catMap[key]
			if c == nil {
				c = &TexCategory{Name: seg[0], Dir: "assets/" + ns + "/textures/" + seg[0]}
				catMap[key] = c
			}
			c.Count++
		}
	}
	categories := make([]TexCategory, 0, len(catMap))
	for _, c := range catMap {
		categories = append(categories, *c)
	}
	sort.SliceStable(categories, func(i, j int) bool {
		if categories[i].Count != categories[j].Count {
			return categories[i].Count > categories[j].Count
		}
		return categories[i].Name < categories[j].Name
	})

	out := &PackTextures{
		Name:        name,
		Kind:        kind,
		Dir:         browseDir,
		Namespaces:  namespaces,
		Categories:  categories,
		Dirs:        []BrowseDir{},
		Breadcrumbs: []Breadcrumb{{Name: "root", Dir: nil}},
		Files:       []BrowseFile{},
		Total:       total,
		Offset:      offset,
		Limit:       limit,
	}

	if browseDir != "" {
		out.Parent = parentBrowseDir(browseDir)
		prefix := browseDir + "/"
		sub := make(map[string]*BrowseDir, 16)
		fl := make([]BrowseFile, 0, 64)
		for _, t := range texs {
			if !strings.HasPrefix(t.Path, prefix) {
				continue
			}
			rest := t.Path[len(prefix):]
			seg := strings.Split(rest, "/")
			if len(seg) >= 2 {
				d := sub[seg[0]]
				if d == nil {
					d = &BrowseDir{Name: seg[0], Dir: browseDir + "/" + seg[0]}
					sub[seg[0]] = d
				}
				d.Count++
			} else {
				fl = append(fl, BrowseFile{Path: t.Path, Name: seg[0], Size: t.Size})
			}
		}
		dirs := make([]BrowseDir, 0, len(sub))
		for _, d := range sub {
			dirs = append(dirs, *d)
		}
		sort.SliceStable(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })
		sort.SliceStable(fl, func(i, j int) bool { return fl[i].Name < fl[j].Name })
		out.Dirs = dirs
		out.FilesTotal = len(fl)
		end := offset + limit
		if offset > len(fl) {
			offset = len(fl)
		}
		if end > len(fl) {
			end = len(fl)
		}
		out.Files = fl[offset:end]
		// 面包屑：assets/<ns>/textures 之后的每一级
		segs := strings.Split(browseDir, "/")
		for i := 3; i < len(segs); i++ {
			d := strings.Join(segs[:i+1], "/")
			out.Breadcrumbs = append(out.Breadcrumbs, Breadcrumb{Name: segs[i], Dir: &d})
		}
	} else {
		// 根视图：全部贴图平铺分页
		fl := make([]BrowseFile, 0, len(texs))
		for _, t := range texs {
			parts := strings.Split(t.Path, "/")
			fl = append(fl, BrowseFile{Path: t.Path, Name: parts[len(parts)-1], Size: t.Size})
		}
		sort.SliceStable(fl, func(i, j int) bool { return fl[i].Path < fl[j].Path })
		out.FilesTotal = total
		end := offset + limit
		if offset > len(fl) {
			offset = len(fl)
		}
		if end > len(fl) {
			end = len(fl)
		}
		out.Files = fl[offset:end]
	}
	return out, nil
}

// assertBrowsePath 校验文件浏览路径（包根相对，禁止穿越）。
func assertBrowsePath(dir string) (string, error) {
	if dir == "" {
		return "", nil
	}
	if strings.HasPrefix(dir, "/") || strings.HasSuffix(dir, "/") ||
		strings.Contains(dir, `\`) || strings.Contains(dir, "..") ||
		strings.ContainsRune(dir, 0) {
		return "", fmt.Errorf("invalid browse path")
	}
	return dir, nil
}

// normalizeZipBrowseName 把 zip 条目名归一化到包根相对路径。
func normalizeZipBrowseName(name string) string {
	if strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "META-INF/") {
		return name
	}
	idx := strings.Index(name, "/")
	if idx <= 0 {
		return name
	}
	rest := name[idx+1:]
	first := rest
	if j := strings.Index(rest, "/"); j >= 0 {
		first = rest[:j]
	}
	switch {
	case strings.HasPrefix(rest, "assets/"), strings.HasPrefix(rest, "META-INF/"):
		return rest
	case first == "pack.mcmeta", first == "pack.png", first == VersionJSONName,
		first == "credits.txt", first == "LICENSE":
		return rest
	case strings.HasPrefix(first, "README"):
		return rest
	}
	return name
}

// browseBreadcrumbs 构造文件浏览的面包屑。
func browseBreadcrumbs(dir string) []Breadcrumb {
	crumbs := []Breadcrumb{{Name: "root", Dir: nil}}
	if dir == "" {
		return crumbs
	}
	segs := strings.Split(dir, "/")
	for i := range segs {
		d := strings.Join(segs[:i+1], "/")
		crumbs = append(crumbs, Breadcrumb{Name: segs[i], Dir: &d})
	}
	return crumbs
}

// PackEntries 是 listPackEntries 的返回。
type PackEntries struct {
	Name        string       `json:"name"`
	Kind        string       `json:"kind"`
	Dir         string       `json:"dir"`
	Parent      *string      `json:"parent"`
	Breadcrumbs []Breadcrumb `json:"breadcrumbs"`
	Dirs        []BrowseDir  `json:"dirs"`
	Files       []BrowseFile `json:"files"`
	Total       int          `json:"total"`
	Truncated   bool         `json:"truncated"`
}

// ListPackEntries 列出包内任意目录的直接子项（文件管理器式）。
func ListPackEntries(root, name, dir string) (*PackEntries, error) {
	st, full, err := statPack(root, name)
	if err != nil {
		return nil, err
	}
	browseDir, err := assertBrowsePath(dir)
	if err != nil {
		return nil, err
	}
	out := &PackEntries{
		Name:        name,
		Dir:         browseDir,
		Breadcrumbs: browseBreadcrumbs(browseDir),
		Dirs:        []BrowseDir{},
		Files:       []BrowseFile{},
	}
	if browseDir != "" {
		segs := strings.Split(browseDir, "/")
		if len(segs) > 1 {
			p := strings.Join(segs[:len(segs)-1], "/")
			out.Parent = &p
		}
	}

	if st.IsDir() {
		out.Kind = "dir"
		base := ResolveDirPack(full)
		if base == "" {
			base = full
		}
		base = filepath.Clean(base)
		abs := base
		if browseDir != "" {
			abs = filepath.Clean(filepath.Join(base, filepath.FromSlash(browseDir)))
			if abs != base && !strings.HasPrefix(abs, base+string(filepath.Separator)) {
				return nil, fmt.Errorf("invalid browse path")
			}
		}
		ents, err := os.ReadDir(abs)
		if err != nil {
			return nil, fmt.Errorf("directory not found: %s", orDot(browseDir))
		}
		for _, e := range ents {
			if strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if e.IsDir() {
				out.Dirs = append(out.Dirs, BrowseDir{Name: e.Name()})
			} else if e.Type().IsRegular() {
				f := BrowseFile{Name: e.Name()}
				if info, err := e.Info(); err == nil {
					f.Size = info.Size()
					f.Mtime = float64(info.ModTime().UnixMilli())
				}
				out.Files = append(out.Files, f)
			}
		}
	} else {
		out.Kind = "zip"
		files, err := readZipEntries(full)
		if err != nil {
			return nil, err
		}
		dirPrefix := ""
		if browseDir != "" {
			dirPrefix = browseDir + "/"
		}
		dirSet := make(map[string]bool, 16)
		dirs := make([]BrowseDir, 0, 16)
		for _, f := range files {
			n := normalizeZipBrowseName(f.Name)
			if n == "" {
				continue
			}
			rest := n
			if browseDir != "" {
				if !strings.HasPrefix(n, dirPrefix) {
					continue
				}
				rest = n[len(dirPrefix):]
			}
			seg := strings.Split(rest, "/")
			if len(seg) >= 2 {
				if !dirSet[seg[0]] {
					dirSet[seg[0]] = true
					dirs = append(dirs, BrowseDir{Name: seg[0]})
				}
			} else if seg[0] != "" {
				out.Files = append(out.Files, BrowseFile{Name: seg[0], Size: int64(f.UncompressedSize64)})
			}
		}
		out.Dirs = dirs
	}

	sort.SliceStable(out.Dirs, func(i, j int) bool { return out.Dirs[i].Name < out.Dirs[j].Name })
	sort.SliceStable(out.Files, func(i, j int) bool { return out.Files[i].Name < out.Files[j].Name })

	total := len(out.Dirs) + len(out.Files)
	if total > BrowseMaxEntries {
		out.Truncated = true
		if len(out.Dirs) > BrowseMaxEntries {
			out.Dirs = out.Dirs[:BrowseMaxEntries]
		}
		remain := BrowseMaxEntries - len(out.Dirs)
		if remain < 0 {
			remain = 0
		}
		if len(out.Files) > remain {
			out.Files = out.Files[:remain]
		}
	}
	out.Total = total
	return out, nil
}

// orDot 空字符串回落为 "."。
func orDot(s string) string {
	if s == "" {
		return "."
	}
	return s
}

// 保证 zip 包被引用（readZipEntries 返回 []*zip.File）。
var _ = (*zip.File)(nil)
var _ = path.Clean
