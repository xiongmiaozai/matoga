// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"archive/zip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// 图片扩展名候选表（与 Node 版 IMG_EXT_LIST 一致）。
var imgExtList = []string{"png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"}

const mcmetaSuffix = ".mcmeta"

// AssertValidRelPath 校验包内相对路径，禁止穿越与绝对路径。
//
// anyExt 为 true 时放宽扩展名限制（模型导出用）。
func AssertValidRelPath(rel string, anyExt bool) (string, error) {
	if rel == "" {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
	}
	if strings.HasPrefix(rel, "/") || filepath.IsAbs(rel) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
	}
	if strings.Contains(rel, "..") || strings.Contains(rel, `\`) || strings.ContainsRune(rel, 0) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
	}
	if !anyExt {
		if !strings.HasPrefix(rel, "assets/") {
			return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
		}
	}
	return rel, nil
}

// imgVariantKeys 返回同 stem 的图片扩展名候选集合；非图片扩展名返回 nil。
func imgVariantKeys(relL string) map[string]bool {
	isMeta := strings.HasSuffix(relL, mcmetaSuffix)
	base := relL
	if isMeta {
		base = strings.TrimSuffix(base, mcmetaSuffix)
	}
	dot := strings.LastIndex(base, ".")
	slash := strings.LastIndex(base, "/")
	if dot <= slash || dot < 0 {
		return nil
	}
	ext := base[dot+1:]
	found := false
	for _, e := range imgExtList {
		if e == ext {
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	stem := base[:dot]
	out := make(map[string]bool, len(imgExtList))
	for _, e := range imgExtList {
		out[stem+"."+e] = true
	}
	return out
}

// fuzzyVariantKey 计算模糊比较键；mcmeta 查询只与 .mcmeta 条目比较，反之亦然。
func fuzzyVariantKey(nameL string, isMetaQuery bool) (string, bool) {
	isMetaEntry := strings.HasSuffix(nameL, mcmetaSuffix)
	if isMetaQuery {
		if isMetaEntry {
			return strings.TrimSuffix(nameL, mcmetaSuffix), true
		}
		return "", false
	}
	if isMetaEntry {
		return "", false
	}
	return nameL, true
}

// FindZipEntry 按归一化路径查 zip 条目，逐级降级匹配。
//
// 层级：精确 → assets 归一 → 任意层嵌套（取最浅）→ 以上三者的大小写不敏感
// → 图片扩展名变体。模糊层仅兜底原本会 404 的请求。
func FindZipEntry(files []*zip.File, rel string) *zip.File {
	relL := strings.ToLower(rel)
	isMeta := strings.HasSuffix(relL, mcmetaSuffix)
	variants := imgVariantKeys(relL)

	var norm, nested, icExact, icNorm, icNested, variantHit *zip.File
	nestedDepth := 1 << 30
	icNestedDepth := 1 << 30

	for _, f := range files {
		n := f.Name
		if n == rel {
			return f
		}
		p := normalizeZipTexName(n)
		if norm == nil && p == rel {
			norm = f
		}
		nL := strings.ToLower(n)
		if icExact == nil && nL == relL {
			icExact = f
		}
		if p != "" && icNorm == nil && strings.ToLower(p) == relL {
			icNorm = f
		}
		depth := strings.Count(n, "/") + 1
		if strings.HasSuffix(n, "/"+rel) && depth < nestedDepth {
			nested, nestedDepth = f, depth
		}
		if strings.HasSuffix(nL, "/"+relL) && depth < icNestedDepth {
			icNested, icNestedDepth = f, depth
		}
		if variantHit == nil && variants != nil {
			if key, ok := fuzzyVariantKey(nL, isMeta); ok && variants[key] {
				variantHit = f
			}
		}
	}
	for _, c := range []*zip.File{norm, nested, icExact, icNorm, icNested, variantHit} {
		if c != nil {
			return c
		}
	}
	return nil
}

// readZipFileBytes 读取 zip 条目内容。
func readZipFileBytes(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// MimeOf 按扩展名返回 MIME。
func MimeOf(name string) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")) {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	case "bmp":
		return "image/bmp"
	case "tif", "tiff":
		return "image/tiff"
	case "avif":
		return "image/avif"
	case "hdr":
		return "image/vnd.radiance"
	case "exr":
		return "image/x-exr"
	case "json", "mcmeta":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}

// PackFile 是读取结果。
type PackFile struct {
	Buf  []byte `json:"-"`
	Mime string `json:"mime"`
}

// resolveDirFileFuzzy 在目录里按大小写/扩展名变体找文件。
func resolveDirFileFuzzy(dirAbs, rel string) string {
	ents, err := os.ReadDir(dirAbs)
	if err != nil {
		return ""
	}
	want := rel[strings.LastIndex(rel, "/")+1:]
	wantL := strings.ToLower(want)
	isMeta := strings.HasSuffix(wantL, mcmetaSuffix)
	variants := imgVariantKeys(wantL)
	variantHit := ""
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		nL := strings.ToLower(e.Name())
		if nL == wantL {
			return e.Name()
		}
		if variants == nil || variantHit != "" {
			continue
		}
		if key, ok := fuzzyVariantKey(nL, isMeta); ok && variants[key] {
			variantHit = e.Name()
		}
	}
	return variantHit
}

// ReadPackFile 读取包内单个文件，支持目录包与 zip 包。
//
// root 是包根目录，name 是包名（目录名或 .zip），relPath 是包内相对路径。
// anyExt 为 true 时允许任意扩展名（模型导出用）。
func ReadPackFile(root, name, relPath string, anyExt bool) (*PackFile, error) {
	rel, err := AssertValidRelPath(relPath, anyExt)
	if err != nil {
		return nil, err
	}
	full := filepath.Join(root, name)
	st, err := os.Stat(full)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "pack not found: "+name)
	}

	if st.IsDir() {
		base := ResolveDirPack(full)
		if base == "" {
			base = full
		}
		absBase := filepath.Clean(base)
		file := filepath.Clean(filepath.Join(absBase, filepath.FromSlash(rel)))
		if !strings.HasPrefix(file, absBase+string(filepath.Separator)) {
			return nil, httpx.Errorf(httpx.CodeInvalidParam, "invalid texture path")
		}
		buf, err := os.ReadFile(file)
		if err == nil {
			return &PackFile{Buf: buf, Mime: MimeOf(rel)}, nil
		}
		// 模糊兜底：实际文件名大小写/扩展名与模型引用不一致（社区包常见）
		dir := filepath.Dir(file)
		if hit := resolveDirFileFuzzy(dir, rel); hit != "" {
			if b, e := os.ReadFile(filepath.Join(dir, hit)); e == nil {
				return &PackFile{Buf: b, Mime: MimeOf(hit)}, nil
			}
		}
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "texture not found: "+rel)
	}

	// zip 包：必须持有 reader 直到读完条目内容，否则 f.Open() 报 "file already closed"
	zr, err := openZipReader(full)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "open zip failed: "+err.Error())
	}
	defer zr.Close()
	entry := FindZipEntry(zr.File, rel)
	if entry == nil {
		return nil, httpx.Errorf(httpx.CodeFSNotFound, "texture not found: "+rel)
	}
	buf, err := readZipFileBytes(entry)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "read zip entry failed: "+err.Error())
	}
	return &PackFile{Buf: buf, Mime: MimeOf(entry.Name)}, nil
}

var _ = errors.New
