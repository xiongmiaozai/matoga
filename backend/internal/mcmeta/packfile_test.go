// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package mcmeta

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestReadPackFileDir 读取目录包内的单个文件。
func TestReadPackFileDir(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "dirpack", []string{
		"assets/minecraft/textures/block/stone.png",
	}, true)

	pf, err := ReadPackFile(root, "dirpack", "assets/minecraft/textures/block/stone.png", false)
	if err != nil {
		t.Fatalf("ReadPackFile: %v", err)
	}
	if pf.Mime != "image/png" {
		t.Errorf("Mime = %q, want image/png", pf.Mime)
	}
	if len(pf.Buf) == 0 {
		t.Error("Buf 为空")
	}
}

// TestReadPackFileZip 读取 zip 包内的单个文件。
//
// 回归用例：readZipEntries 会在返回时关闭 reader，导致 f.Open() 报
// "file already closed"。ReadPackFile 必须自己持有 reader。
func TestReadPackFileZip(t *testing.T) {
	root := t.TempDir()
	const body = "ZIP-CONTENT-12345"
	writeZip(t, root, "z.zip", map[string]string{
		"assets/minecraft/textures/item/apple.png": body,
	})

	pf, err := ReadPackFile(root, "z.zip", "assets/minecraft/textures/item/apple.png", false)
	if err != nil {
		t.Fatalf("ReadPackFile(zip): %v", err)
	}
	if string(pf.Buf) != body {
		t.Errorf("Buf = %q, want %q", string(pf.Buf), body)
	}
	if pf.Mime != "image/png" {
		t.Errorf("Mime = %q, want image/png", pf.Mime)
	}
}

// TestReadPackFileZipTwice 连续读两次同一 zip，确认 reader 未泄漏也未提前关闭。
func TestReadPackFileZipTwice(t *testing.T) {
	root := t.TempDir()
	writeZip(t, root, "z2.zip", map[string]string{
		"assets/ns/textures/block/a.png": "AAA",
		"assets/ns/textures/block/b.png": "BBB",
	})
	for _, want := range []struct{ rel, body string }{
		{"assets/ns/textures/block/a.png", "AAA"},
		{"assets/ns/textures/block/b.png", "BBB"},
	} {
		pf, err := ReadPackFile(root, "z2.zip", want.rel, false)
		if err != nil {
			t.Fatalf("ReadPackFile(%s): %v", want.rel, err)
		}
		if string(pf.Buf) != want.body {
			t.Errorf("%s Buf = %q, want %q", want.rel, string(pf.Buf), want.body)
		}
	}
}

// TestReadPackFileZipNestedRoot zip 外层套了一层文件夹时仍能定位。
func TestReadPackFileZipNestedRoot(t *testing.T) {
	root := t.TempDir()
	const body = "NESTED"
	writeZip(t, root, "nested.zip", map[string]string{
		"outer/assets/minecraft/textures/block/n.png": body,
	})
	pf, err := ReadPackFile(root, "nested.zip", "assets/minecraft/textures/block/n.png", false)
	if err != nil {
		t.Fatalf("ReadPackFile: %v", err)
	}
	if string(pf.Buf) != body {
		t.Errorf("Buf = %q, want %q", string(pf.Buf), body)
	}
}

// TestReadPackFileNotFound 包内不存在该文件时报 ERR_FS_NOT_FOUND。
func TestReadPackFileNotFound(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "p", []string{"assets/minecraft/textures/block/a.png"}, true)
	_, err := ReadPackFile(root, "p", "assets/minecraft/textures/block/missing.png", false)
	if err == nil {
		t.Fatal("期望报错，实际成功")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("错误信息 = %v", err)
	}
}

// TestReadPackFileUnknownPack 包本身不存在。
func TestReadPackFileUnknownPack(t *testing.T) {
	root := t.TempDir()
	_, err := ReadPackFile(root, "nope", "assets/minecraft/textures/block/a.png", false)
	if err == nil {
		t.Fatal("期望报错，实际成功")
	}
	if !strings.Contains(err.Error(), "pack not found") {
		t.Errorf("错误信息 = %v", err)
	}
}

// TestReadPackFileRejectsTraversal 包内相对路径不允许跳出包根。
func TestReadPackFileRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	mkPackDir(t, root, "p", []string{"assets/minecraft/textures/block/a.png"}, true)
	for _, rel := range []string{
		"../../../etc/passwd",
		"assets/../../../../etc/passwd",
		"assets/minecraft/../../../secret.txt",
	} {
		if _, err := ReadPackFile(root, "p", rel, false); err == nil {
			t.Errorf("路径 %q 应被拒绝", rel)
		}
	}
}

// TestReadPackFileFuzzyExt 实际文件扩展名与请求不一致时模糊兜底。
func TestReadPackFileFuzzyExt(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "fz", "assets", "minecraft", "textures", "block")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	// 请求 .png，磁盘上只有 .jpg
	if err := os.WriteFile(filepath.Join(base, "tex.jpg"), []byte("JPGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fz", "pack.mcmeta"), []byte(`{"pack":{"pack_format":15}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	pf, err := ReadPackFile(root, "fz", "assets/minecraft/textures/block/tex.png", false)
	if err != nil {
		t.Fatalf("模糊兜底失败: %v", err)
	}
	if string(pf.Buf) != "JPGDATA" {
		t.Errorf("Buf = %q", string(pf.Buf))
	}
	if pf.Mime != "image/jpeg" {
		t.Errorf("Mime = %q, want image/jpeg", pf.Mime)
	}
}

// TestMimeOf 常见扩展名映射。
//
// Node 版 MIME_BY_EXT 只有 png/jpg/jpeg/webp/gif/bmp/tif/tiff/avif，其余一律
// application/octet-stream。Go 版额外映射 hdr/exr/json/mcmeta，供 HDRI 预设与
// 模型 JSON 直读使用；这里把两套行为都固化下来，避免以后误改。
func TestMimeOf(t *testing.T) {
	cases := map[string]string{
		"a.png":  "image/png",
		"a.PNG":  "image/png",
		"a.jpg":  "image/jpeg",
		"a.jpeg": "image/jpeg",
		"a.webp": "image/webp",
		"a.gif":  "image/gif",
		"a.bmp":  "image/bmp",
		"a.tif":  "image/tiff",
		"a.tiff": "image/tiff",
		"a.avif": "image/avif",
		// Go 版额外映射
		"a.hdr":    "image/vnd.radiance",
		"a.exr":    "image/x-exr",
		"a.json":   "application/json",
		"a.mcmeta": "application/json",
		// 两版一致：未收录的扩展名回落二进制
		"a.tga":     "application/octet-stream",
		"a.unknown": "application/octet-stream",
		"noext":     "application/octet-stream",
	}
	for name, want := range cases {
		if got := MimeOf(name); got != want {
			t.Errorf("MimeOf(%q) = %q, want %q", name, got, want)
		}
	}
}

// TestAssertValidRelPath 相对路径校验。
func TestAssertValidRelPath(t *testing.T) {
	ok := []string{
		"assets/minecraft/textures/block/a.png",
		"assets/ns/models/block/b.json",
	}
	for _, rel := range ok {
		if _, err := AssertValidRelPath(rel, false); err != nil {
			t.Errorf("AssertValidRelPath(%q) 应通过: %v", rel, err)
		}
	}
	bad := []string{
		"",
		"/etc/passwd",
		"../evil.png",
		"assets/../../evil.png",
		"assets\\minecraft\\textures\\a.png",
		"textures/a.png", // 缺 assets/ 前缀
	}
	for _, rel := range bad {
		if _, err := AssertValidRelPath(rel, false); err == nil {
			t.Errorf("AssertValidRelPath(%q) 应被拒绝", rel)
		}
	}
}
