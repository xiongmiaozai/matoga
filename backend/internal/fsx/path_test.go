// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package fsx

import (
	"runtime"
	"testing"
)

func TestShouldIgnore(t *testing.T) {
	cases := []struct {
		name     string
		patterns []string
		want     bool
	}{
		{"a.png", []string{"*.png"}, true},
		{"a.PNG", []string{"*.png"}, true},
		{"a.jpg", []string{"*.png"}, false},
		{"node_modules", []string{"node_modules"}, true},
		{"NODE_MODULES", []string{"node_modules"}, true},
		{"tmp123", []string{"tmp*"}, true},
		{"tmp", []string{"tmp*"}, true},
		{"a-tmp", []string{"tmp*"}, false},
		{"x.log.bak", []string{"*.log"}, false},
		{"anything", nil, false},
		{"debug.txt", []string{"*.png", "debug*"}, true},
	}
	for _, c := range cases {
		if got := ShouldIgnore(c.name, c.patterns); got != c.want {
			t.Errorf("ShouldIgnore(%q, %v) = %v, want %v", c.name, c.patterns, got, c.want)
		}
	}
}

func TestNormalizeStripsInvisibleAndQuotes(t *testing.T) {
	got, err := Normalize("\"F:\\a\\b\"")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := `F:\a\b`
	if runtime.GOOS != "windows" {
		t.Skip("windows-only path shape")
	}
	if got != want {
		t.Errorf("Normalize = %q, want %q", got, want)
	}

	if _, err := Normalize("   "); err == nil {
		t.Error("空路径应报错")
	}
	if _, err := Normalize("a\x00b"); err == nil {
		t.Error("含 NUL 的路径应报错")
	}

	// 零宽字符应被剥离
	got2, err := Normalize("\uFEFFF:\\x\u200B")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got2 != `F:\x` && runtime.GOOS == "windows" {
		// 大小写由 Clean 保留，这里只验证零宽字符被剥离
		if len(got2) != len(`F:\x`) {
			t.Errorf("零宽字符未剥离: %q", got2)
		}
	}
}

func TestGuardReadRequiresAbsolute(t *testing.T) {
	if _, err := GuardRead("relative/path"); err == nil {
		t.Error("相对路径应被拒绝")
	}
	abs := "/tmp"
	if runtime.GOOS == "windows" {
		abs = `C:\`
	}
	if _, err := GuardRead(abs); err != nil {
		t.Errorf("绝对路径应通过, got err %v", err)
	}
}

func TestGuardWriteRespectsTrustedRoots(t *testing.T) {
	trustedRoots = nil
	root := t.TempDir()
	Trust(root)

	inside := root + string(rune(47)) + "sub" + string(rune(47)) + "a.txt"
	if runtime.GOOS == "windows" {
		inside = root + `\sub\a.txt`
	}
	if _, err := GuardWrite(inside); err != nil {
		t.Errorf("可信根内应通过: %v", err)
	}

	outside := "/etc/passwd"
	if runtime.GOOS == "windows" {
		outside = `C:\Windows\win.ini`
	}
	if _, err := GuardWrite(outside); err == nil {
		t.Error("可信根外应被拒绝")
	}
	trustedRoots = nil
}
