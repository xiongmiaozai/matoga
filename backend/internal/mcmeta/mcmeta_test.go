// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// writeZip 用标准库生成一个测试 zip，entries 为 相对路径 → 内容。
func writeZip(t *testing.T, dir, name string, entries map[string]string) string {
	t.Helper()
	full := filepath.Join(dir, name)
	f, err := os.Create(full)
	if err != nil {
		t.Fatalf("创建 zip: %v", err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for p, body := range entries {
		w, err := zw.Create(p)
		if err != nil {
			t.Fatalf("写入条目 %s: %v", p, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("写入内容 %s: %v", p, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("关闭 zip: %v", err)
	}
	return full
}

// mkPackDir 造一个目录包：assets/<ns>/<sub>/... 下的若干文件。
func mkPackDir(t *testing.T, root, name string, files []string, withMcmeta bool) string {
	t.Helper()
	base := filepath.Join(root, name)
	for _, rel := range files {
		p := filepath.Join(base, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	if withMcmeta {
		if err := os.WriteFile(filepath.Join(base, McmetaName), []byte(`{"pack":{"pack_format":15}}`), 0o644); err != nil {
			t.Fatalf("write mcmeta: %v", err)
		}
	}
	return base
}

func TestValidPackName(t *testing.T) {
	good := []string{"pack", "My Pack.zip", "a-b_c.d", "包名"}
	for _, n := range good {
		if !ValidPackName(n) {
			t.Errorf("ValidPackName(%q) = false, want true", n)
		}
	}
	bad := []string{"", ".", "..", "a/b", `a\b`, " pad ", string([]byte{'a', 0, 'b'})}
	for _, n := range bad {
		if ValidPackName(n) {
			t.Errorf("ValidPackName(%q) = true, want false", n)
		}
	}
}

func TestListPackTexGroupsDir(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "mypack", []string{
		"assets/minecraft/textures/block/stone.png",
		"assets/minecraft/textures/block/dirt.png",
		"assets/minecraft/textures/item/apple.png",
		"assets/minecraft/textures/top.png",        // 根级贴图 → key ""
		"assets/minecraft/textures/block/note.txt", // 非图片 → 排除
		"assets/minecraft/models/block/stone.json", // 模型不进贴图
	}, true)

	g, err := ListPackTexGroups(root, "mypack")
	if err != nil {
		t.Fatalf("ListPackTexGroups: %v", err)
	}
	if g.Kind != "dir" {
		t.Errorf("kind = %q, want dir", g.Kind)
	}
	if g.Total != 4 {
		t.Errorf("total = %d, want 4", g.Total)
	}
	// 三个分组：根级（key ""）置首，其后按数量降序
	if len(g.Groups) != 3 {
		t.Fatalf("分组数 = %d, want 3 (%+v)", len(g.Groups), g.Groups)
	}
	if g.Groups[0].Key != "" || g.Groups[0].Count != 1 {
		t.Errorf("首组应为根级 1 条, got key=%q count=%d", g.Groups[0].Key, g.Groups[0].Count)
	}
	if g.Groups[1].Key != "block" || g.Groups[1].Count != 2 {
		t.Errorf("次组应为 block 2 条, got key=%q count=%d", g.Groups[1].Key, g.Groups[1].Count)
	}
	if g.Groups[2].Key != "item" || g.Groups[2].Count != 1 {
		t.Errorf("末组应为 item 1 条, got key=%q count=%d", g.Groups[2].Key, g.Groups[2].Count)
	}
	// 目录包应补齐 size/mtime
	for _, f := range g.Groups[1].Files {
		if f.Size == 0 {
			t.Errorf("目录包 %s 未补齐 size", f.Path)
		}
	}
}

func TestListPackTexGroupsZip(t *testing.T) {
	root := t.TempDir()
	writeZip(t, root, "mypack.zip", map[string]string{
		"assets/minecraft/textures/block/a.png":  "aa",
		"assets/minecraft/textures/block/b.png":  "bb",
		"assets/minecraft/textures/gui/c.png":    "cc",
		"assets/minecraft/textures/block/x.json": "{}", // 非图片 → 排除
		"pack.mcmeta":                            "{}", // 非贴图 → 排除
	})

	g, err := ListPackTexGroups(root, "mypack.zip")
	if err != nil {
		t.Fatalf("ListPackTexGroups: %v", err)
	}
	if g.Kind != "zip" {
		t.Errorf("kind = %q, want zip", g.Kind)
	}
	if g.Total != 3 {
		t.Errorf("total = %d, want 3", g.Total)
	}
	if len(g.Groups) != 2 {
		t.Fatalf("分组数 = %d, want 2", len(g.Groups))
	}
	// block 2 条应排前
	if g.Groups[0].Key != "block" || g.Groups[0].Count != 2 {
		t.Errorf("首组应为 block 2 条, got key=%q count=%d", g.Groups[0].Key, g.Groups[0].Count)
	}
	// zip 包 size 来自未压缩大小
	for _, f := range g.Groups[0].Files {
		if f.Size != 2 {
			t.Errorf("%s size = %d, want 2", f.Path, f.Size)
		}
	}
}

func TestZipNestedRootFolder(t *testing.T) {
	root := t.TempDir()
	// 包内容套了一层根文件夹
	writeZip(t, root, "nested.zip", map[string]string{
		"mypack-1.0/assets/minecraft/textures/block/a.png": "aa",
	})
	g, err := ListPackTexGroups(root, "nested.zip")
	if err != nil {
		t.Fatalf("ListPackTexGroups: %v", err)
	}
	if g.Total != 1 {
		t.Fatalf("total = %d, want 1（应剥离根文件夹）", g.Total)
	}
	if got := g.Groups[0].Files[0].Path; got != "assets/minecraft/textures/block/a.png" {
		t.Errorf("path = %q, want 归一化后的 assets/...", got)
	}
}

func TestListPackModelGroupsDir(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "mpack", []string{
		"assets/minecraft/models/block/stone.json",
		"assets/minecraft/models/block/dirt.json",
		"assets/minecraft/models/item/stick.json",
		"assets/minecraft/items/diamond_sword.json", // 1.21.4+ 物品定义 → items 组
		"assets/minecraft/blockstates/stone.json",   // blockstates 排除
		"assets/minecraft/textures/block/stone.png", // 贴图不进模型
	}, true)

	g, err := ListPackModelGroups(root, "mpack")
	if err != nil {
		t.Fatalf("ListPackModelGroups: %v", err)
	}
	if g.Total != 4 {
		t.Errorf("total = %d, want 4", g.Total)
	}
	keys := map[string]int{}
	for _, grp := range g.Groups {
		keys[grp.Key] = grp.Count
	}
	if keys["block"] != 2 {
		t.Errorf("block 组 = %d, want 2", keys["block"])
	}
	if keys["item"] != 1 {
		t.Errorf("item 组 = %d, want 1", keys["item"])
	}
	if keys["items"] != 1 {
		t.Errorf("items 组 = %d, want 1", keys["items"])
	}
}

func TestListPackNotFound(t *testing.T) {
	root := t.TempDir()
	if _, err := ListPackTexGroups(root, "nope"); err == nil {
		t.Error("不存在的包应报错")
	}
	if _, err := ListPackTexGroups(root, "a/b"); err == nil {
		t.Error("非法包名应报错")
	}
}

func TestResolveDirPackNested(t *testing.T) {
	root := t.TempDir()
	// 外层自身没有 assets / pack.mcmeta，只有唯一子目录 inner 才是真包根
	outer := filepath.Join(root, "outer")
	inner := filepath.Join(outer, "inner")
	p := filepath.Join(inner, "assets", "minecraft", "textures", "block", "a.png")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inner, McmetaName), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ResolveDirPack(outer); got != inner {
		t.Errorf("ResolveDirPack = %q, want %q", got, inner)
	}
}

func TestResolveDirPackDirect(t *testing.T) {
	root := t.TempDir()
	// 自身带 assets 的目录直接作为包根
	base := mkPackDir(t, root, "direct", []string{"assets/minecraft/textures/block/a.png"}, false)
	if got := ResolveDirPack(base); got != base {
		t.Errorf("ResolveDirPack = %q, want %q", got, base)
	}
	// 既无 mcmeta 也无 assets → 无法识别
	empty := filepath.Join(root, "empty")
	if err := os.MkdirAll(empty, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ResolveDirPack(empty); got != "" {
		t.Errorf("空目录 ResolveDirPack = %q, want 空串", got)
	}
}

func TestListPacks(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "packA", []string{"assets/minecraft/textures/block/a.png"}, true)
	mkPackDir(t, root, "packB", []string{"assets/minecraft/textures/block/b.png"}, true)
	// 非包目录与非法扩展名应被跳过
	if err := os.MkdirAll(filepath.Join(root, ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	packs := ListPacks(root, ListPackTexGroups)
	if len(packs) != 2 {
		t.Fatalf("包数 = %d, want 2 (%+v)", len(packs), packs)
	}
	if packs[0].Name != "packA" || packs[1].Name != "packB" {
		t.Errorf("排序错误: %s, %s", packs[0].Name, packs[1].Name)
	}
}

func TestListPacksEmptyRoot(t *testing.T) {
	if got := ListPacks("", ListPackTexGroups); len(got) != 0 {
		t.Errorf("空 root 应返回空, got %d", len(got))
	}
	if got := ListPacks(filepath.Join(t.TempDir(), "nope"), ListPackTexGroups); len(got) != 0 {
		t.Errorf("不存在 root 应返回空, got %d", len(got))
	}
}
