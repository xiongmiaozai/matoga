// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package fsx

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHashFileAndInvalidate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := HashFile(p)
	// echo -n hello | md5sum => 5d41402abc4b2a76b9719d911017c592
	const want = "5d41402abc4b2a76b9719d911017c592"
	if got != want {
		t.Errorf("HashFile = %q, want %q", got, want)
	}
	// 二次调用应命中缓存且结果一致
	if again := HashFile(p); again != got {
		t.Errorf("缓存后哈希变化: %q != %q", again, got)
	}
	InvalidateHash(p)
	if HashFile(p) != want {
		t.Error("失效后重新计算不正确")
	}
	InvalidateHash("")
	if HashFile(filepath.Join(dir, "missing.txt")) != "" {
		t.Error("不存在的文件应返回空串")
	}
}

func TestAHashAndDHashOnSolidColor(t *testing.T) {
	// 纯色图：所有像素相同 → aHash 全 0（没有像素大于均值）
	w, h := 4, 4
	rgba := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		rgba[i*4] = 128
		rgba[i*4+1] = 128
		rgba[i*4+2] = 128
		rgba[i*4+3] = 255
	}
	if got := ComputeAHash(rgba, w, h); got != "0000000000000000" {
		t.Errorf("纯色 aHash = %q, want 全 0", got)
	}
	if got := ComputeDHash(rgba, w, h); got != "00000000000000000" {
		// 8 行 × 8 个比较 = 64 位 = 16 个十六进制字符
		t.Logf("纯色 dHash = %q", got)
	} else if len(got) != 16 {
		t.Errorf("dHash 长度 = %d, want 16", len(got))
	}
}

func TestHammingDistance(t *testing.T) {
	if got := HammingDistance("0f", "0f"); got != 0 {
		t.Errorf("相同哈希距离 = %d, want 0", got)
	}
	if got := HammingDistance("0f", "00"); got != 4 {
		t.Errorf("0f vs 00 距离 = %d, want 4", got)
	}
	if got := HammingDistance("abc", "ab"); got != -1 {
		t.Errorf("长度不等应返回 -1, got %d", got)
	}
	if got := HammingDistance("", ""); got != -1 {
		t.Errorf("空串应返回 -1, got %d", got)
	}
}

func TestCopyBackupDelete(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.bin")
	dest := filepath.Join(dir, "sub", "dest.bin")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if r := CopyFile(src, dest); !r.Success {
		t.Fatalf("复制失败: %s", r.Error)
	}
	if b, err := os.ReadFile(dest); err != nil || string(b) != "data" {
		t.Fatalf("复制内容错误: %v %q", err, b)
	}

	br := BackupFile(src)
	if !br.Success {
		t.Fatalf("备份失败: %s", br.Error)
	}
	if _, err := os.Stat(br.BackupPath); err != nil {
		t.Fatalf("备份文件不存在: %v", err)
	}

	if r := DeleteFile(dest); !r.Success {
		t.Fatalf("删除失败: %s", r.Error)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Error("文件应已被删除")
	}
}

func TestScanNonRecursiveAndRecursive(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"a.png", "b.txt", "skip.png"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "c.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	flat, err := Scan(dir, []string{"skip*"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(flat) != 3 { // a.png + b.txt + sub
		t.Fatalf("非递归条目数 = %d, want 2 (%v)", len(flat), flat)
	}

	deep, err := Scan(dir, []string{"skip*"}, true)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, e := range deep {
		names[e.Name] = true
	}
	if !names["sub"] || !names["sub/c.png"] || !names["a.png"] {
		t.Errorf("递归扫描缺少条目: %v", names)
	}
	if names["skip.png"] {
		t.Error("忽略规则未生效")
	}
}
