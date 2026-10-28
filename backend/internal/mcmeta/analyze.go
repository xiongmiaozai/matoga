// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// VersionJSONName 是 jar 解包布局的版本文件。
const VersionJSONName = "version.json"

// FormatVersion 是 pack_format 到 MC 版本范围的映射项。
type FormatVersion struct {
	Format   int    `json:"format"`
	Versions string `json:"versions"`
}

// PackFormatVersions 是资源包格式与 MC 版本的对照表（Java 版）。
var PackFormatVersions = []FormatVersion{
	{1, "1.6.1 – 1.8.9"},
	{2, "1.9 – 1.10.2"},
	{3, "1.11 – 1.12.2"},
	{4, "1.13 – 1.14.4"},
	{5, "1.15 – 1.16.1"},
	{6, "1.16.2 – 1.16.5"},
	{7, "1.17 – 1.17.1"},
	{8, "1.18 – 1.18.2"},
	{9, "1.19 – 1.19.2"},
	{12, "1.19.3"},
	{13, "1.19.4"},
	{15, "1.20 – 1.20.1"},
	{18, "1.20.2"},
	{22, "1.20.3 – 1.20.4"},
	{32, "1.20.5 – 1.20.6"},
	{34, "1.21 – 1.21.1"},
	{42, "1.21.2 – 1.21.3"},
	{46, "1.21.4"},
	{55, "1.21.5"},
	{63, "1.21.6"},
	{64, "1.21.7 – 1.21.8"},
	{97, "26.3"},
}

var formatIndex = func() map[int]string {
	m := make(map[int]string, len(PackFormatVersions))
	for _, e := range PackFormatVersions {
		m[e.Format] = e.Versions
	}
	return m
}()

// FormatToVersions 把 pack_format 转成 MC 版本范围，未知格式返回空串。
func FormatToVersions(format int) string { return formatIndex[format] }

// PackEntry 是单个资源包的分析结果。
type PackEntry struct {
	Name         string   `json:"name"`
	FullPath     string   `json:"fullPath"`
	IsDirectory  bool     `json:"isDirectory"`
	Size         int64    `json:"size"`
	Mtime        float64  `json:"mtime"`
	Kind         string   `json:"kind"`
	Valid        bool     `json:"valid"`
	Format       *int     `json:"format"`
	MinFormat    *int     `json:"minFormat"`
	MaxFormat    *int     `json:"maxFormat"`
	FormatLabel  *string  `json:"formatLabel"`
	FormatRange  string   `json:"formatRange"`
	Description  string   `json:"description"`
	Namespaces   []string `json:"namespaces"`
	TextureCount int      `json:"textureCount"`
	FirstTexture *string  `json:"firstTexture"`
	Error        string   `json:"error"`
}

// mcmetaParsed 是 pack.mcmeta 的解析结果。
type mcmetaParsed struct {
	Format      *int
	MinFormat   *int
	MaxFormat   *int
	Description string
}

// versionInfo 是 version.json 的解析结果。
type versionInfo struct {
	Format       *int
	FormatLabel  *string
	VersionRange string
}

// plainDescription 去掉 §格式码并取纯文本。
func plainDescription(raw any) string {
	var s string
	switch v := raw.(type) {
	case string:
		s = v
	case map[string]any:
		if t, ok := v["text"].(string); ok {
			s = t
		} else if t, ok := v["translate"].(string); ok {
			s = t
		}
	}
	return strings.TrimSpace(stripSectionCodes(s))
}

// stripSectionCodes 去掉 § 加一个字符的格式码。
func stripSectionCodes(s string) string {
	if !strings.ContainsRune(s, '§') {
		return s
	}
	rs := []rune(s)
	out := make([]rune, 0, len(rs))
	for i := 0; i < len(rs); i++ {
		if rs[i] == '§' && i+1 < len(rs) {
			i++
			continue
		}
		out = append(out, rs[i])
	}
	return string(out)
}

// numberToPtr 把 JSON 数值转成 *int，非数值返回 nil。
func numberToPtr(v any) *int {
	f, ok := v.(float64)
	if !ok {
		return nil
	}
	n := int(f)
	return &n
}

// ParseMcmetaText 解析 pack.mcmeta 文本。
func ParseMcmetaText(text string) (*mcmetaParsed, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		return nil, fmt.Errorf("pack.mcmeta is not valid JSON")
	}
	pack, ok := raw["pack"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf(`pack.mcmeta missing "pack" field`)
	}
	out := &mcmetaParsed{
		Format:      numberToPtr(pack["pack_format"]),
		Description: plainDescription(pack["description"]),
	}
	switch sup := pack["supported_formats"].(type) {
	case map[string]any:
		out.MinFormat = numberToPtr(sup["min_format_inclusive"])
		out.MaxFormat = numberToPtr(sup["max_format_inclusive"])
	case []any:
		if len(sup) >= 2 {
			out.MinFormat = numberToPtr(sup[0])
			out.MaxFormat = numberToPtr(sup[1])
		}
	}
	return out, nil
}

// ParseVersionJSON 解析 version.json（jar 解包布局）。
func ParseVersionJSON(text string) *versionInfo {
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		return nil
	}
	pv, _ := raw["pack_version"].(map[string]any)
	major := numberToPtr(pv["resource_major"])
	var minor int
	if m := numberToPtr(pv["resource_minor"]); m != nil {
		minor = *m
	}
	id := ""
	if s, ok := raw["id"].(string); ok && s != "" {
		id = s
	} else if s, ok := raw["name"].(string); ok {
		id = s
	}
	vi := &versionInfo{Format: major, VersionRange: id}
	if major != nil {
		label := fmt.Sprintf("%d", *major)
		if minor != 0 {
			label = fmt.Sprintf("%d.%d", *major, minor)
		}
		vi.FormatLabel = &label
	}
	return vi
}

// tryReadVersionJSON 读取包根的 version.json，缺失或损坏返回 nil。
func tryReadVersionJSON(root string) *versionInfo {
	b, err := os.ReadFile(filepath.Join(root, VersionJSONName))
	if err != nil {
		return nil
	}
	return ParseVersionJSON(string(b))
}

// buildFormatRange 由解析结果构造可读的版本范围。
func buildFormatRange(m *mcmetaParsed) string {
	if m.MinFormat != nil || m.MaxFormat != nil {
		min, max := "", ""
		if m.MinFormat != nil {
			min = FormatToVersions(*m.MinFormat)
		}
		if m.MaxFormat != nil {
			max = FormatToVersions(*m.MaxFormat)
		}
		if min != "" && max != "" {
			if min == max {
				return min
			}
			return min + " – " + max
		}
		if min != "" {
			return min
		}
		if max != "" {
			return max
		}
		n := m.MinFormat
		if n == nil {
			n = m.MaxFormat
		}
		return fmt.Sprintf("pack_format %d", *n)
	}
	if m.Format != nil {
		return FormatToVersions(*m.Format)
	}
	return ""
}

// readDirNamespaces 列出 assets/ 下的命名空间目录。
func readDirNamespaces(dir string) []string {
	ents, err := os.ReadDir(filepath.Join(dir, "assets"))
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(ents))
	for _, e := range ents {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			out = append(out, e.Name())
		}
	}
	return out
}

// collectZipNamespaces 从 zip 条目收集命名空间。
func collectZipNamespaces(files []*zip.File) []string {
	seen := make(map[string]bool, 16)
	out := make([]string, 0, 16)
	for _, f := range files {
		if !strings.HasPrefix(f.Name, AssetsPrefix) {
			continue
		}
		rest := f.Name[len(AssetsPrefix):]
		if rest == "" || strings.HasPrefix(rest, "/") {
			continue
		}
		first := strings.SplitN(rest, "/", 2)[0]
		if first != "" && !seen[first] {
			seen[first] = true
			out = append(out, first)
		}
	}
	return out
}

// pickMcmetaEntry 精确找 pack.mcmeta，否则取嵌套层级最浅的那个。
func pickMcmetaEntry(files []*zip.File) *zip.File {
	for _, f := range files {
		if f.Name == McmetaName {
			return f
		}
	}
	var best *zip.File
	bestDepth := 0
	for _, f := range files {
		if !strings.HasSuffix(f.Name, "/"+McmetaName) {
			continue
		}
		d := strings.Count(f.Name, "/")
		if best == nil || d < bestDepth {
			best, bestDepth = f, d
		}
	}
	return best
}

// zipHasEntry 判断 zip 内是否存在指定条目（忽略套层根）。
func zipHasEntry(files []*zip.File, want string) bool {
	for _, f := range files {
		if f.Name == want {
			return true
		}
	}
	for _, f := range files {
		if strings.HasSuffix(f.Name, "/"+want) {
			return true
		}
	}
	return false
}

// dirHasFile 判断目录下是否存在指定文件。
func dirHasFile(dir, name string) bool {
	st, err := os.Stat(filepath.Join(dir, name))
	return err == nil && !st.IsDir()
}

// strPtr 返回字符串指针。
func strPtr(s string) *string { return &s }

// AnalyzePack 分析单个资源包（目录或 zip）。
func AnalyzePack(fullPath string, st os.FileInfo) PackEntry {
	name := filepath.Base(fullPath)
	entry := PackEntry{
		Name:        name,
		FullPath:    fullPath,
		IsDirectory: st.IsDir(),
		Mtime:       float64(st.ModTime().UnixMilli()),
		Kind:        "dir",
		Namespaces:  []string{},
	}
	if st.IsDir() {
		entry.Kind = "dir"
	} else {
		entry.Kind = "file"
		entry.Size = st.Size()
	}

	var text *string
	var vi *versionInfo

	if st.IsDir() {
		packRoot := ResolveDirPack(fullPath)
		if packRoot == "" {
			entry.Error = "pack.mcmeta not found"
			return entry
		}
		entry.Namespaces = readDirNamespaces(packRoot)
		if dirHasFile(packRoot, McmetaName) {
			if b, err := os.ReadFile(filepath.Join(packRoot, McmetaName)); err == nil {
				s := string(b)
				text = &s
			}
		} else {
			vi = tryReadVersionJSON(packRoot)
		}
		texs := walkDirTextures(packRoot)
		entry.TextureCount = len(texs)
		if dirHasFile(packRoot, "pack.png") {
			entry.FirstTexture = strPtr("pack.png")
		} else if len(texs) > 0 {
			entry.FirstTexture = strPtr(texs[0].Path)
		}
		if text == nil {
			entry.Error = "pack.mcmeta not found"
		}
	} else {
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
		if !ZipExts[ext] {
			entry.Error = "not a resource pack (folder or .zip)"
			return entry
		}
		entry.Kind = "zip"
		files, err := readZipEntries(fullPath)
		if err != nil {
			entry.Error = err.Error()
			return entry
		}
		entry.Namespaces = collectZipNamespaces(files)
		texs := zipTextureEntries(files)
		entry.TextureCount = len(texs)
		if zipHasEntry(files, "pack.png") {
			entry.FirstTexture = strPtr("pack.png")
		} else if len(texs) > 0 {
			entry.FirstTexture = strPtr(texs[0].Path)
		}
		mc := pickMcmetaEntry(files)
		if mc == nil {
			entry.Error = "pack.mcmeta not found in archive"
			if vj := findZipByName(files, VersionJSONName); vj != nil {
				if b, err := readZipEntryBytes(fullPath, vj); err == nil {
					vi = ParseVersionJSON(string(b))
				}
			}
		} else if b, err := readZipEntryBytes(fullPath, mc); err == nil {
			s := string(b)
			text = &s
		}
	}

	if text == nil {
		// 缺 pack.mcmeta：回退 version.json 还原版本
		if vi != nil && (vi.Format != nil || vi.VersionRange != "") {
			entry.Format = vi.Format
			entry.FormatLabel = vi.FormatLabel
			entry.FormatRange = vi.VersionRange
			entry.Valid = true
			entry.Error = ""
		}
		return entry
	}

	m, err := ParseMcmetaText(*text)
	if err != nil {
		entry.Error = err.Error()
		return entry
	}
	entry.Format = m.Format
	entry.MinFormat = m.MinFormat
	entry.MaxFormat = m.MaxFormat
	entry.Description = m.Description
	entry.FormatRange = buildFormatRange(m)
	entry.Valid = true
	return entry
}

// findZipByName 按精确名或任意层级后缀查找条目。
func findZipByName(files []*zip.File, want string) *zip.File {
	for _, f := range files {
		if f.Name == want {
			return f
		}
	}
	for _, f := range files {
		if strings.HasSuffix(f.Name, "/"+want) {
			return f
		}
	}
	return nil
}

// ListOfficialPacks 列出 root 下全部资源包（含版本分析与贴图统计）。
func ListOfficialPacks(root string) (map[string]any, error) {
	ents, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{"root": root, "exists": false, "packs": []PackEntry{}}, nil
		}
		return nil, fmt.Errorf("read pack root: %w", err)
	}
	packs := make([]PackEntry, 0, len(ents))
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(root, e.Name())
		st, err := os.Stat(full)
		if err != nil {
			continue
		}
		if !st.IsDir() {
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(e.Name()), "."))
			if !ZipExts[ext] {
				continue
			}
		}
		packs = append(packs, AnalyzePack(full, st))
	}
	sort.SliceStable(packs, func(i, j int) bool { return packs[i].Name < packs[j].Name })
	return map[string]any{"root": root, "exists": true, "packs": packs}, nil
}

// RenamePack 重命名资源包目录/文件。
func RenamePack(root, fromName, toName string) (map[string]any, error) {
	if !ValidPackName(fromName) {
		return nil, fmt.Errorf("invalid source name")
	}
	if !ValidPackName(toName) {
		return nil, fmt.Errorf("invalid target name")
	}
	from := filepath.Join(root, fromName)
	to := filepath.Join(root, toName)
	if _, err := os.Stat(from); err != nil {
		return nil, fmt.Errorf("source pack not found: %s", fromName)
	}
	if _, err := os.Stat(to); err == nil {
		return nil, fmt.Errorf("target already exists: %s", toName)
	}
	if err := os.Rename(from, to); err != nil {
		return nil, err
	}
	return map[string]any{"from": from, "to": to, "name": toName}, nil
}

// readZipEntryBytes 重新打开 zip 读取指定条目字节。
//
// readZipEntries 返回前已 defer Close，*zip.File 的 Open 会失败，
// 因此需要字节时必须单独开一次 reader。
func readZipEntryBytes(zipPath string, want *zip.File) ([]byte, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name == want.Name {
			return readZipFileBytes(f)
		}
	}
	return nil, fmt.Errorf("zip entry not found: %s", want.Name)
}
