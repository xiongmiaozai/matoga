// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package syncpack 把模型 JSON 写入 MC 资源包目录，使 Minecraft 可直接加载。
//
// 目标路径为 <mcPacksPath>/<packName>/assets/<ns>/models/....json，
// 写入前强制校验相对路径，防止越出包目录。
package syncpack

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Result 是同步结果。
type Result struct {
	Dest string `json:"dest"`
	Size int    `json:"size"`
}

// assertSafeRel 校验相对路径必须在 assets/ 下且不含 ..
//
// 这是防路径穿越的关键闸门：packName 与 relPath 都来自请求，
// 任一未校验都可能写到包目录之外。
func assertSafeRel(rel string) (string, error) {
	p := strings.ReplaceAll(rel, `\`, "/")
	if !strings.HasPrefix(p, "assets/") {
		return "", fmt.Errorf("relPath must start with assets/")
	}
	if strings.Contains(p, "..") {
		return "", fmt.Errorf("relPath must not contain ..")
	}
	return p, nil
}

// SyncModelJSON 把模型 JSON 写入资源包。
//
// json 可为字符串（原样写入）或任意可序列化值（缩进 2 空格写入），
// 与 Node 侧行为一致，便于用户对比生成结果。
func SyncModelJSON(root, packName, relPath string, model any) (*Result, error) {
	if root == "" {
		return nil, fmt.Errorf("mcPacksPath not configured")
	}
	if packName == "" {
		return nil, fmt.Errorf("packName required")
	}
	if relPath == "" {
		return nil, fmt.Errorf("relPath required")
	}
	safe, err := assertSafeRel(relPath)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(safe, ".json") {
		return nil, fmt.Errorf("relPath must end with .json")
	}

	var content []byte
	if s, ok := model.(string); ok {
		content = []byte(s)
	} else {
		content, err = json.MarshalIndent(model, "", "  ")
		if err != nil {
			return nil, fmt.Errorf("marshal model: %w", err)
		}
	}

	dest := filepath.Join(root, packName, filepath.FromSlash(safe))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(dest, content, 0o644); err != nil {
		return nil, err
	}
	return &Result{Dest: dest, Size: len(content)}, nil
}
