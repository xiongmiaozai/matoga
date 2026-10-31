// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"archive/zip"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mkPack 在 root 下造一个目录资源包。
// files 是相对包根的路径列表（如 "assets/demo/textures/block/a.png"）。
func mkPack(t *testing.T, root, name string, files []string, mcmeta string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	for _, rel := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if mcmeta != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), []byte(mcmeta), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// mkZipPack 在 root 下造一个 zip 资源包。
func mkZipPack(t *testing.T, root, name string, entries map[string]string) string {
	t.Helper()
	p := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for n, body := range entries {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

// packRoot 返回测试环境里某个包路由的根目录。
func packRoot(t *testing.T, e *testEnv, key string) string {
	t.Helper()
	v, ok := e.config.Get()[key].(string)
	if !ok || v == "" {
		t.Fatalf("配置缺 %s", key)
	}
	return v
}

func TestPacksListEmpty(t *testing.T) {
	e := newEnv(t)
	for _, prefix := range []string{"/api/craft-packs", "/api/mc-packs", "/api/mc-official"} {
		d := data(t, e.get(t, prefix+"/list"))
		if d["exists"] != false {
			t.Errorf("%s exists = %v, want false", prefix, d["exists"])
		}
		packs, _ := d["packs"].([]any)
		if len(packs) != 0 {
			t.Errorf("%s packs = %d, want 0", prefix, len(packs))
		}
	}
}

func TestPacksListWithDirPack(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "demo-pack", []string{
		"assets/demo/textures/block/a.png",
		"assets/demo/textures/block/b.png",
		"assets/demo/textures/item/c.png",
	}, `{"pack":{"pack_format":15,"description":"演示包"}}`)

	d := data(t, e.get(t, "/api/mc-official/list"))
	if d["exists"] != true {
		t.Fatalf("exists = %v", d["exists"])
	}
	packs, _ := d["packs"].([]any)
	if len(packs) != 1 {
		t.Fatalf("packs = %d, want 1", len(packs))
	}
	p, _ := packs[0].(map[string]any)
	if p["name"] != "demo-pack" {
		t.Errorf("name = %v", p["name"])
	}
	if p["valid"] != true {
		t.Errorf("valid = %v, error=%v", p["valid"], p["error"])
	}
	if p["format"] != float64(15) {
		t.Errorf("format = %v, want 15", p["format"])
	}
	if p["description"] != "演示包" {
		t.Errorf("description = %v", p["description"])
	}
	if p["textureCount"] != float64(3) {
		t.Errorf("textureCount = %v, want 3", p["textureCount"])
	}
	if p["kind"] != "dir" {
		t.Errorf("kind = %v", p["kind"])
	}
	// 版本范围应从 pack_format 15 推出来
	fr, _ := p["formatRange"].(string)
	if !strings.Contains(fr, "1.20") {
		t.Errorf("formatRange = %v, 应含 1.20", fr)
	}
	// 命名空间
	ns, _ := p["namespaces"].([]any)
	if len(ns) != 1 || ns[0] != "demo" {
		t.Errorf("namespaces = %v", ns)
	}
}

func TestPacksListWithoutMcmeta(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "mcPacksPath")
	// 无 pack.mcmeta，但有 assets → ResolveDirPack 仍能定根，entry.error 提示缺 mcmeta
	mkPack(t, root, "bare-pack", []string{
		"assets/bare/textures/block/x.png",
	}, "")

	d := data(t, e.get(t, "/api/mc-packs/list"))
	packs, _ := d["packs"].([]any)
	if len(packs) != 1 {
		t.Fatalf("packs = %d", len(packs))
	}
	p, _ := packs[0].(map[string]any)
	if p["valid"] != false {
		t.Errorf("valid = %v, want false", p["valid"])
	}
	if p["error"] == "" {
		t.Error("error 应提示缺 pack.mcmeta")
	}
	if p["textureCount"] != float64(1) {
		t.Errorf("textureCount = %v, want 1", p["textureCount"])
	}
}

func TestPacksListZip(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "craftPacksPath")
	mkZipPack(t, root, "zip-pack.zip", map[string]string{
		"pack.mcmeta":                    `{"pack":{"pack_format":34,"description":"zip 包"}}`,
		"assets/zp/textures/block/z.png": "x",
		"assets/zp/textures/item/z2.png": "x",
	})

	d := data(t, e.get(t, "/api/craft-packs/list"))
	packs, _ := d["packs"].([]any)
	if len(packs) != 1 {
		t.Fatalf("packs = %d", len(packs))
	}
	p, _ := packs[0].(map[string]any)
	if p["kind"] != "zip" {
		t.Errorf("kind = %v, want zip", p["kind"])
	}
	if p["valid"] != true {
		t.Errorf("valid = %v, error=%v", p["valid"], p["error"])
	}
	if p["format"] != float64(34) {
		t.Errorf("format = %v, want 34", p["format"])
	}
	if p["textureCount"] != float64(2) {
		t.Errorf("textureCount = %v, want 2", p["textureCount"])
	}
}

func TestPacksVersionMap(t *testing.T) {
	e := newEnv(t)
	// mc-official 有 version-map
	d := data(t, e.get(t, "/api/mc-official/version-map"))
	m, _ := d["map"].([]any)
	if len(m) == 0 {
		t.Fatal("version-map 为空")
	}
	first, _ := m[0].(map[string]any)
	if first["format"] != float64(1) {
		t.Errorf("首项 format = %v", first["format"])
	}
	if first["versions"] == "" {
		t.Error("首项 versions 为空")
	}

	// mc-packs / craft-packs 无此端点：请求落到 chi 的纯文本 404，不是 JSON 错误体
	for _, prefix := range []string{"/api/mc-packs", "/api/craft-packs"} {
		res := e.rawGet(t, prefix+"/version-map")
		if res.status != http.StatusNotFound {
			t.Errorf("%s/version-map status = %d, want 404", prefix, res.status)
		}
		if strings.Contains(res.contentType, "json") {
			t.Errorf("%s/version-map 应返回纯文本 404，实际 Content-Type = %s", prefix, res.contentType)
		}
		if !strings.Contains(string(res.body), "404") {
			t.Errorf("%s/version-map 正文 = %q", prefix, res.body)
		}
	}
}

func TestPacksRename(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "mcPacksPath")
	mkPack(t, root, "old-name", []string{"assets/n/textures/block/a.png"}, `{"pack":{"pack_format":15}}`)

	raw := e.do(t, "PUT", "/api/mc-packs/rename", map[string]any{
		"from": "old-name", "to": "new-name",
	})
	if raw["ok"] != true {
		t.Fatalf("rename 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	if d["name"] != "new-name" {
		t.Errorf("name = %v", d["name"])
	}
	if _, err := os.Stat(filepath.Join(root, "new-name")); err != nil {
		t.Fatal("新目录不存在")
	}
	if _, err := os.Stat(filepath.Join(root, "old-name")); err == nil {
		t.Error("旧目录仍存在")
	}
}

func TestPacksRenameErrors(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "mcPacksPath")
	mkPack(t, root, "src", []string{"assets/a/textures/block/a.png"}, `{"pack":{"pack_format":15}}`)
	mkPack(t, root, "dst", []string{"assets/b/textures/block/b.png"}, `{"pack":{"pack_format":15}}`)

	// 目标已存在
	raw := e.do(t, "PUT", "/api/mc-packs/rename", map[string]any{"from": "src", "to": "dst"})
	if raw["code"] != "ERR_ALREADY_EXISTS" {
		t.Errorf("目标存在 code = %v", raw["code"])
	}
	// 源不存在
	raw = e.do(t, "PUT", "/api/mc-packs/rename", map[string]any{"from": "nope", "to": "x"})
	if raw["code"] != "ERR_FS_NOT_FOUND" {
		t.Errorf("源缺失 code = %v", raw["code"])
	}
	// 非法名
	raw = e.do(t, "PUT", "/api/mc-packs/rename", map[string]any{"from": "src", "to": "a/b"})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("非法名 code = %v", raw["code"])
	}
}

func TestPacksTexturesRoot(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "tex-pack", []string{
		"assets/tp/textures/block/a.png",
		"assets/tp/textures/block/b.png",
		"assets/tp/textures/item/c.png",
	}, `{"pack":{"pack_format":15}}`)

	d := data(t, e.get(t, "/api/mc-official/tex-pack/textures"))
	if d["kind"] != "dir" {
		t.Errorf("kind = %v", d["kind"])
	}
	if d["total"] != float64(3) {
		t.Errorf("total = %v, want 3", d["total"])
	}
	// 根视图：全部平铺
	files, _ := d["files"].([]any)
	if len(files) != 3 {
		t.Errorf("files = %d, want 3", len(files))
	}
	// 类别：block 2、item 1
	cats, _ := d["categories"].([]any)
	if len(cats) != 2 {
		t.Fatalf("categories = %d, want 2", len(cats))
	}
	c0, _ := cats[0].(map[string]any)
	if c0["name"] != "block" || c0["count"] != float64(2) {
		t.Errorf("首类别 = %v (应 block/2)", c0)
	}
	// 命名空间
	ns, _ := d["namespaces"].([]any)
	if len(ns) != 1 || ns[0] != "tp" {
		t.Errorf("namespaces = %v", ns)
	}
}

func TestPacksTexturesBrowse(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "browse-pack", []string{
		"assets/bp/textures/block/door/a.png",
		"assets/bp/textures/block/door/b.png",
		"assets/bp/textures/block/top.png",
	}, `{"pack":{"pack_format":15}}`)

	// 进 block 层：应有 door 子目录 + top.png
	d := data(t, e.get(t, "/api/mc-official/browse-pack/textures?dir=assets/bp/textures/block"))
	dirs, _ := d["dirs"].([]any)
	if len(dirs) != 1 {
		t.Fatalf("dirs = %d, want 1", len(dirs))
	}
	dd, _ := dirs[0].(map[string]any)
	if dd["name"] != "door" || dd["count"] != float64(2) {
		t.Errorf("子目录 = %v (应 door/2)", dd)
	}
	files, _ := d["files"].([]any)
	if len(files) != 1 {
		t.Errorf("files = %d, want 1", len(files))
	}
	// 面包屑：root → block
	crumbs, _ := d["breadcrumbs"].([]any)
	if len(crumbs) != 2 {
		t.Errorf("breadcrumbs = %d, want 2", len(crumbs))
	}
	// parent 应是 assets/bp/textures
	if d["parent"] != "assets/bp/textures" {
		t.Errorf("parent = %v", d["parent"])
	}

	// 进 door 层：只有文件
	d = data(t, e.get(t, "/api/mc-official/browse-pack/textures?dir=assets/bp/textures/block/door"))
	files, _ = d["files"].([]any)
	if len(files) != 2 {
		t.Errorf("door files = %d, want 2", len(files))
	}
	crumbs, _ = d["breadcrumbs"].([]any)
	if len(crumbs) != 3 {
		t.Errorf("door breadcrumbs = %d, want 3", len(crumbs))
	}
}

func TestPacksTexturesPaging(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	files := make([]string, 0, 10)
	for i := 0; i < 10; i++ {
		files = append(files, "assets/pg/textures/block/f"+string(rune('a'+i))+".png")
	}
	mkPack(t, root, "page-pack", files, `{"pack":{"pack_format":15}}`)

	d := data(t, e.get(t, "/api/mc-official/page-pack/textures?offset=0&limit=3"))
	got, _ := d["files"].([]any)
	if len(got) != 3 {
		t.Errorf("limit=3 files = %d", len(got))
	}
	if d["filesTotal"] != float64(10) {
		t.Errorf("filesTotal = %v, want 10", d["filesTotal"])
	}
	d = data(t, e.get(t, "/api/mc-official/page-pack/textures?offset=8&limit=5"))
	got, _ = d["files"].([]any)
	if len(got) != 2 {
		t.Errorf("尾部 files = %d, want 2", len(got))
	}
}

func TestPacksTexturesRejectsBadDir(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "safe-pack", []string{"assets/sp/textures/block/a.png"}, `{"pack":{"pack_format":15}}`)

	for _, bad := range []string{
		"../etc",
		"assets/sp/textures/../../x",
		`assets\sp\textures`,
		"/assets/sp/textures",
		"assets/sp/models",
	} {
		body := e.get(t, "/api/mc-official/safe-pack/textures?dir="+urlQuery(bad))
		if body["code"] != "ERR_INVALID_PARAM" {
			t.Errorf("dir=%q code = %v, want ERR_INVALID_PARAM", bad, body["code"])
		}
	}
}

func TestPacksEntriesDir(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "ent-pack", []string{
		"assets/ep/textures/block/a.png",
		"assets/ep/models/block/m.json",
		"pack.mcmeta",
	}, `{"pack":{"pack_format":15}}`)

	// 根：应有 assets 目录 + pack.mcmeta 文件
	d := data(t, e.get(t, "/api/mc-official/ent-pack/entries"))
	dirs, _ := d["dirs"].([]any)
	if len(dirs) != 1 {
		t.Fatalf("根 dirs = %d, want 1", len(dirs))
	}
	files, _ := d["files"].([]any)
	if len(files) != 1 {
		t.Errorf("根 files = %d, want 1（pack.mcmeta）", len(files))
	}
	if d["kind"] != "dir" {
		t.Errorf("kind = %v", d["kind"])
	}
	if d["parent"] != nil {
		t.Errorf("根 parent = %v, want nil", d["parent"])
	}

	// 进 assets/ep
	d = data(t, e.get(t, "/api/mc-official/ent-pack/entries?dir=assets/ep"))
	dirs, _ = d["dirs"].([]any)
	if len(dirs) != 2 {
		t.Errorf("assets/ep dirs = %d, want 2（models/textures）", len(dirs))
	}
}

func TestPacksEntriesZip(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "craftPacksPath")
	mkZipPack(t, root, "ent.zip", map[string]string{
		"pack.mcmeta":                    `{"pack":{"pack_format":34}}`,
		"assets/ez/textures/block/a.png": "x",
	})

	d := data(t, e.get(t, "/api/craft-packs/ent.zip/entries"))
	if d["kind"] != "zip" {
		t.Errorf("kind = %v", d["kind"])
	}
	// 根：assets 目录 + pack.mcmeta
	dirs, _ := d["dirs"].([]any)
	if len(dirs) != 1 {
		t.Errorf("zip 根 dirs = %d, want 1", len(dirs))
	}
}

func TestPacksRaw(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	content := "\x89PNG\r\n\x1a\nRAWBYTES"
	dir := mkPack(t, root, "raw-pack", nil, `{"pack":{"pack_format":15}}`)
	p := filepath.Join(dir, "assets", "rp", "textures", "block", "a.png")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	// 用原始 HTTP 取字节（e.get 会按 JSON 解析）
	res := e.rawGet(t, "/api/mc-official/raw-pack/raw?path=assets/rp/textures/block/a.png")
	if res.status != 200 {
		t.Fatalf("status = %d", res.status)
	}
	if string(res.body) != content {
		t.Errorf("body = %q, want %q", string(res.body), content)
	}
	if !strings.HasPrefix(res.contentType, "image/png") {
		t.Errorf("Content-Type = %q", res.contentType)
	}
}

func TestPacksRawRejectsTraversal(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "tr-pack", []string{"assets/tp/textures/block/a.png"}, `{"pack":{"pack_format":15}}`)

	for _, bad := range []string{"../secret", "assets/../../x", `assets\a`} {
		body := e.get(t, "/api/mc-official/tr-pack/raw?path="+urlQuery(bad))
		if body["code"] != "ERR_INVALID_PARAM" {
			t.Errorf("path=%q code = %v, want ERR_INVALID_PARAM", bad, body["code"])
		}
	}
}

func TestPacksUnknownPack(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	body := e.get(t, "/api/mc-official/nope/textures")
	if body["code"] != "ERR_FS_NOT_FOUND" {
		t.Errorf("未知包 code = %v", body["code"])
	}
	// 含 ".." 的路径在 HTTP 层被规范化，不再匹配路由，落到 SPA 静态兜底。
	// 关键是绝不能返回包内容，也不能读到 root 之外的文件。
	res := e.rawGet(t, "/api/mc-official/../evil/textures")
	if res.status == http.StatusOK && strings.Contains(res.contentType, "json") {
		t.Errorf("穿越包名返回了 API 响应: status=%d body=%.200s", res.status, res.body)
	}
	if strings.Contains(string(res.body), "assets/") {
		t.Error("穿越包名泄露了包内容")
	}
}

// TestPacksJSONShape 校验 list 的 JSON 结构与 Node 版字段名一致。
func TestPacksJSONShape(t *testing.T) {
	e := newEnv(t)
	root := packRoot(t, e, "officialPacksPath")
	mkPack(t, root, "shape-pack", []string{"assets/sh/textures/block/a.png"}, `{"pack":{"pack_format":15}}`)

	body := e.get(t, "/api/mc-official/list")
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	d, _ := back["data"].(map[string]any)
	for _, key := range []string{"root", "exists", "packs"} {
		if _, ok := d[key]; !ok {
			t.Errorf("list 缺字段 %q", key)
		}
	}
	packs, _ := d["packs"].([]any)
	p, _ := packs[0].(map[string]any)
	for _, key := range []string{
		"name", "fullPath", "isDirectory", "size", "mtime", "kind", "valid",
		"format", "minFormat", "maxFormat", "formatLabel", "formatRange",
		"description", "namespaces", "textureCount", "firstTexture", "error",
	} {
		if _, ok := p[key]; !ok {
			t.Errorf("pack 缺字段 %q", key)
		}
	}
}
