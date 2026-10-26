// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package fsx 提供路径规范化、可信根校验与目录扫描。
package fsx

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// invisible 是需要在路径两端剥离的零宽字符集合（与 Node 版一致）。
const invisible = "\u200B\u200C\u200D\u2060\u180E\uFEFF"

var trustedRoots []string

// Trust 注册一个可信写入根。
func Trust(root string) {
	if root == "" {
		return
	}
	trustedRoots = append(trustedRoots, strings.TrimRight(filepath.Clean(root), `\/`))
}

// TrustedRoots 返回已注册的可信根。
func TrustedRoots() []string { return append([]string(nil), trustedRoots...) }

func stripInvisible(s string) string {
	return strings.Trim(s, invisible)
}

func stripQuotes(s string) string {
	if len(s) >= 2 {
		a, b := s[0], s[len(s)-1]
		if (a == '"' && b == '"') || (a == '\'' && b == '\'') || (a == '`' && b == '`') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// Normalize 规范化用户传入的路径：剥零宽字符与引号、去空白、Clean。
func Normalize(p string) (string, error) {
	if strings.TrimSpace(p) == "" || strings.ContainsRune(p, 0) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
	}
	s := stripInvisible(strings.TrimSpace(p))
	s = stripInvisible(strings.TrimSpace(stripQuotes(s)))
	if s == "" {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid path")
	}
	return filepath.Clean(s), nil
}

// GuardRead 校验为绝对路径。
func GuardRead(p string) (string, error) {
	n, err := Normalize(p)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(n) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "absolute path required")
	}
	return n, nil
}

// GuardWrite 校验为绝对路径且落在可信根内。
func GuardWrite(p string) (string, error) {
	n, err := GuardRead(p)
	if err != nil {
		return "", err
	}
	if withinTrusted(n) {
		return n, nil
	}
	return "", httpx.Errorf(httpx.CodePathDenied, "path outside trusted roots")
}

func withinTrusted(n string) bool {
	cmp := n
	if isWindows() {
		cmp = strings.ToLower(cmp)
	}
	for _, root := range trustedRoots {
		r := root
		if isWindows() {
			r = strings.ToLower(r)
		}
		if cmp == r || strings.HasPrefix(cmp, r+string(os.PathSeparator)) || strings.HasPrefix(cmp, r+"/") {
			return true
		}
	}
	return false
}

func isWindows() bool { return os.PathSeparator == '\\' }

// ShouldIgnore 判断文件名是否匹配忽略规则（支持 `*.ext`、`a*b`、精确名）。
func ShouldIgnore(name string, patterns []string) bool {
	if len(patterns) == 0 {
		return false
	}
	lower := strings.ToLower(name)
	for _, p := range patterns {
		switch {
		case strings.HasPrefix(p, "*."):
			if strings.HasSuffix(lower, strings.ToLower(p[1:])) {
				return true
			}
		case strings.Contains(p, "*"):
			if matchGlob(strings.ToLower(p), lower) {
				return true
			}
		case lower == strings.ToLower(p):
			return true
		}
	}
	return false
}

// matchGlob 只支持 `*`（任意长度）。规则简单，无需完整 glob 语义。
func matchGlob(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	s = s[len(parts[0]):]
	for i := 1; i < len(parts)-1; i++ {
		idx := strings.Index(s, parts[i])
		if idx < 0 {
			return false
		}
		s = s[idx+len(parts[i]):]
	}
	return strings.HasSuffix(s, parts[len(parts)-1])
}
