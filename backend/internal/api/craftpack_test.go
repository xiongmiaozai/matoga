// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// texItem 造一个贴图条目（磁盘绝对路径）。
func texItem(key, name, path string) map[string]any {
	return map[string]any{
		"key": key, "name": name, "type": "tex", "path": path, "mtime": 1000,
	}
}

// writePNG 在 dir 下造一个假 png。
func writePNG(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("\x89PNG\r\n\x1a\nfake"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCraftPackEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/craft-pack"))
	items, _ := d["items"].([]any)
	if len(items) != 0 {
		t.Errorf("初始 items = %d, want 0", len(items))
	}
}

func TestCraftPackPutAndGet(t *testing.T) {
	e := newEnv(t)
	p1 := writePNG(t, e.dir, "a.png")
	p2 := writePNG(t, e.dir, "b.png")

	raw := e.do(t, "PUT", "/api/craft-pack/items", map[string]any{
		"items": []any{texItem("tex:a", "A", p1), texItem("tex:b", "B", p2)},
	})
	if raw["ok"] != true {
		t.Fatalf("PUT 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	if d["count"] != float64(2) {
		t.Errorf("count = %v, want 2", d["count"])
	}

	// 落盘
	p := filepath.Join(e.dir, "data", "craft-pack", "selection.json")
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("selection.json 未落盘: %v", err)
	}

	// 读回 + locatePath
	dl := data(t, e.get(t, "/api/craft-pack"))
	items, _ := dl["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["key"] != "tex:a" {
		t.Errorf("key = %v", first["key"])
	}
	if first["locatePath"] != p1 {
		t.Errorf("locatePath = %v, want %v", first["locatePath"], p1)
	}
}

func TestCraftPackAddRemoveClear(t *testing.T) {
	e := newEnv(t)
	p := writePNG(t, e.dir, "x.png")

	// 追加
	raw := e.do(t, "POST", "/api/craft-pack/items", map[string]any{"item": texItem("tex:x", "X", p)})
	if raw["ok"] != true {
		t.Fatalf("POST 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	if d["added"] != true {
		t.Errorf("added = %v", d["added"])
	}
	if d["count"] != float64(1) {
		t.Errorf("count = %v", d["count"])
	}

	// 重复追加应去重
	raw = e.do(t, "POST", "/api/craft-pack/items", map[string]any{"item": texItem("tex:x", "X", p)})
	d, _ = raw["data"].(map[string]any)
	if d["added"] != false {
		t.Errorf("重复追加 added = %v, want false", d["added"])
	}
	if d["count"] != float64(1) {
		t.Errorf("重复追加 count = %v, want 1", d["count"])
	}

	// 按 key 删除（需 encodeURIComponent）
	key := url.PathEscape("tex:x")
	raw = e.do(t, "DELETE", "/api/craft-pack/items/"+key, nil)
	if raw["ok"] != true {
		t.Fatalf("DELETE 失败: %v", raw)
	}
	d, _ = raw["data"].(map[string]any)
	if d["removed"] != true {
		t.Errorf("removed = %v", d["removed"])
	}

	// 再删一次应为 removed=false
	raw = e.do(t, "DELETE", "/api/craft-pack/items/"+key, nil)
	d, _ = raw["data"].(map[string]any)
	if d["removed"] != false {
		t.Errorf("再删 removed = %v, want false", d["removed"])
	}

	// 清空
	e.do(t, "POST", "/api/craft-pack/items", map[string]any{"item": texItem("tex:x", "X", p)})
	raw = e.do(t, "DELETE", "/api/craft-pack/items", nil)
	d, _ = raw["data"].(map[string]any)
	if d["cleared"] != true {
		t.Errorf("cleared = %v", d["cleared"])
	}
	dl := data(t, e.get(t, "/api/craft-pack"))
	items, _ := dl["items"].([]any)
	if len(items) != 0 {
		t.Errorf("清空后 items = %d, want 0", len(items))
	}
}

func TestCraftPackRejectsBadItem(t *testing.T) {
	e := newEnv(t)

	// 缺 key
	raw := e.do(t, "POST", "/api/craft-pack/items", map[string]any{
		"item": map[string]any{"type": "tex"},
	})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("缺 key code = %v", raw["code"])
	}
	// key 无合法前缀
	raw = e.do(t, "POST", "/api/craft-pack/items", map[string]any{
		"item": map[string]any{"key": "bogus:x", "type": "tex"},
	})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("非法前缀 code = %v", raw["code"])
	}
	// type 与前缀不符
	raw = e.do(t, "POST", "/api/craft-pack/items", map[string]any{
		"item": map[string]any{"key": "tex:x", "type": "hdri"},
	})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("type 不符 code = %v", raw["code"])
	}
}

func TestCraftPackCopySingle(t *testing.T) {
	e := newEnv(t)
	src := writePNG(t, e.dir, "single.png")

	raw := e.do(t, "POST", "/api/craft-pack/copy", map[string]any{
		"item": texItem("tex:single", "Single", src),
	})
	if raw["ok"] != true {
		t.Fatalf("copy 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	if d["written"] != float64(1) {
		t.Errorf("written = %v", d["written"])
	}
	dest, _ := d["dest"].(string)
	if !strings.HasPrefix(dest, "assets/matoga/textures/") {
		t.Errorf("dest = %v", dest)
	}

	// 文件应真实落盘到 制作包目录
	packDir := filepath.Join(e.dir, "craft-packs", "我的制作包")
	full := filepath.Join(packDir, filepath.FromSlash(dest))
	if _, err := os.Stat(full); err != nil {
		t.Fatalf("复制后文件不存在: %v", err)
	}
	// pack.mcmeta 应生成
	if _, err := os.Stat(filepath.Join(packDir, "pack.mcmeta")); err != nil {
		t.Error("pack.mcmeta 未生成")
	}
	// 条目应进入自选清单，并带 craftPath
	dl := data(t, e.get(t, "/api/craft-pack"))
	items, _ := dl["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	it, _ := items[0].(map[string]any)
	if it["craftPath"] != full {
		t.Errorf("craftPath = %v, want %v", it["craftPath"], full)
	}
}

func TestCraftPackCopyDuplicateRenames(t *testing.T) {
	e := newEnv(t)
	src := writePNG(t, e.dir, "dup.png")

	for i := 0; i < 3; i++ {
		raw := e.do(t, "POST", "/api/craft-pack/copy", map[string]any{
			"item": texItem("tex:dup"+string(rune('a'+i)), "Dup", src),
		})
		if raw["ok"] != true {
			t.Fatalf("第 %d 次 copy 失败: %v", i+1, raw)
		}
	}
	packDir := filepath.Join(e.dir, "craft-packs", "我的制作包")
	ents, err := os.ReadDir(filepath.Join(packDir, "assets", "matoga", "textures"))
	if err != nil {
		t.Fatal(err)
	}
	if len(ents) != 3 {
		t.Fatalf("应生成 3 个文件，实际 %d", len(ents))
	}
	names := make([]string, 0, 3)
	for _, x := range ents {
		names = append(names, x.Name())
	}
	joined := strings.Join(names, ",")
	if !strings.Contains(joined, "dup.png") {
		t.Errorf("缺 dup.png: %v", joined)
	}
	if !strings.Contains(joined, "dup-2.png") {
		t.Errorf("缺 dup-2.png: %v", joined)
	}
	if !strings.Contains(joined, "dup-3.png") {
		t.Errorf("缺 dup-3.png: %v", joined)
	}
}

func TestCraftPackExport(t *testing.T) {
	e := newEnv(t)
	p1 := writePNG(t, e.dir, "e1.png")
	p2 := writePNG(t, e.dir, "e2.png")

	raw := e.do(t, "POST", "/api/craft-pack/export", map[string]any{
		"name":        "导出测试包",
		"description": "测试描述",
		"packFormat":  48,
		"items": []any{
			texItem("tex:e1", "E1", p1),
			texItem("tex:e2", "E2", p2),
		},
	})
	if raw["ok"] != true {
		t.Fatalf("export 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	if d["name"] != "导出测试包" {
		t.Errorf("name = %v", d["name"])
	}
	if d["packFormat"] != float64(48) {
		t.Errorf("packFormat = %v, want 48", d["packFormat"])
	}
	if d["written"] != float64(2) {
		t.Errorf("written = %v, want 2", d["written"])
	}
	if d["skipped"] != float64(0) {
		t.Errorf("skipped = %v, want 0", d["skipped"])
	}

	// 目录与文件
	dir, _ := d["dir"].(string)
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("导出目录不存在: %v", err)
	}
	// pack.mcmeta 内容
	b, err := os.ReadFile(filepath.Join(dir, "pack.mcmeta"))
	if err != nil {
		t.Fatalf("pack.mcmeta 缺失: %v", err)
	}
	var meta struct {
		Pack struct {
			Format      int    `json:"pack_format"`
			Description string `json:"description"`
		} `json:"pack"`
	}
	if err := json.Unmarshal(b, &meta); err != nil {
		t.Fatalf("pack.mcmeta 解析失败: %v", err)
	}
	if meta.Pack.Format != 48 {
		t.Errorf("pack_format = %d, want 48", meta.Pack.Format)
	}
	if meta.Pack.Description != "测试描述" {
		t.Errorf("description = %v", meta.Pack.Description)
	}
	// marker
	if _, err := os.Stat(filepath.Join(dir, "matoga-craft.json")); err != nil {
		t.Error("matoga-craft.json 缺失")
	}
}

func TestCraftPackExportDefaultNameStamped(t *testing.T) {
	e := newEnv(t)
	p := writePNG(t, e.dir, "s.png")

	raw := e.do(t, "POST", "/api/craft-pack/export", map[string]any{
		"items": []any{texItem("tex:s", "S", p)},
	})
	if raw["ok"] != true {
		t.Fatalf("export 失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	name, _ := d["name"].(string)
	// 默认名会追加 -yyyyMMdd-HHmmss
	if !strings.HasPrefix(name, "我的制作包-") {
		t.Errorf("name = %v, 应形如 我的制作包-<时间戳>", name)
	}
	if len(name) != len("我的制作包-")+15 {
		t.Errorf("name = %v, 时间戳格式应为 yyyyMMdd-HHmmss（15 字符）", name)
	}
}

func TestCraftPackExportNoItems(t *testing.T) {
	e := newEnv(t)
	raw := e.do(t, "POST", "/api/craft-pack/export", map[string]any{"items": []any{}})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("空导出 code = %v", raw["code"])
	}
}

func TestCraftPackExportInvalidName(t *testing.T) {
	e := newEnv(t)
	p := writePNG(t, e.dir, "n.png")
	raw := e.do(t, "POST", "/api/craft-pack/export", map[string]any{
		"name":  "bad/name",
		"items": []any{texItem("tex:n", "N", p)},
	})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("非法包名 code = %v", raw["code"])
	}
}

func TestCraftPackPacksAndCurrent(t *testing.T) {
	e := newEnv(t)

	// 初始无包
	d := data(t, e.get(t, "/api/craft-pack/packs"))
	packs, _ := d["packs"].([]any)
	if len(packs) != 0 {
		t.Errorf("初始 packs = %d, want 0", len(packs))
	}
	d = data(t, e.get(t, "/api/craft-pack/current"))
	if d["pack"] != nil {
		t.Errorf("初始 current.pack = %v, want nil", d["pack"])
	}

	// 导出一个包
	p := writePNG(t, e.dir, "pk.png")
	raw := e.do(t, "POST", "/api/craft-pack/export", map[string]any{
		"name":  "列包测试",
		"items": []any{texItem("tex:pk", "PK", p)},
	})
	if raw["ok"] != true {
		t.Fatalf("export 失败: %v", raw)
	}

	// packs 应能列出
	d = data(t, e.get(t, "/api/craft-pack/packs"))
	packs, _ = d["packs"].([]any)
	if len(packs) != 1 {
		t.Fatalf("packs = %d, want 1", len(packs))
	}
	pk, _ := packs[0].(map[string]any)
	if pk["name"] != "列包测试" {
		t.Errorf("packs[0].name = %v", pk["name"])
	}
	if pk["written"] != float64(1) {
		t.Errorf("packs[0].written = %v", pk["written"])
	}

	// copy 一次让当前制作包出现
	src := writePNG(t, e.dir, "cur.png")
	e.do(t, "POST", "/api/craft-pack/copy", map[string]any{
		"item": texItem("tex:cur", "CUR", src),
	})
	d = data(t, e.get(t, "/api/craft-pack/current"))
	cur, _ := d["pack"].(map[string]any)
	if cur == nil {
		t.Fatal("current.pack 为空")
	}
	if cur["name"] != "我的制作包" {
		t.Errorf("current.name = %v", cur["name"])
	}
	if cur["fileCount"] != float64(1) {
		t.Errorf("current.fileCount = %v, want 1", cur["fileCount"])
	}
	if cur["packFormat"] != float64(64) {
		t.Errorf("current.packFormat = %v, want 64", cur["packFormat"])
	}
}
