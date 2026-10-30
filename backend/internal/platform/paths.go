// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package platform 提供运行环境相关的路径解析。
package platform

import (
	"os"
	"path/filepath"
)

// Paths 保存运行时路径。
type Paths struct {
	// ResRoot 是程序资源根目录（打包后为二进制所在目录）。
	ResRoot string
	// DataRoot 是用户数据根目录。
	DataRoot string
	// PresetRoot 是预设资源根目录。
	PresetRoot string
}

// ResolvePaths 按与 Node 版 server/paths.js 相同的规则解析路径：
//
//	DATA_ROOT   = $MATOGA_DATA_ROOT || <可执行文件目录>
//	PRESET_ROOT = $MATOGA_PRESET_ROOT || DATA_ROOT
//
// 资源根默认为可执行文件目录（打包后即安装目录）。开发态下二进制通常落在
// 临时目录（如 go run 或 data/tmp 下的构建产物），此时向上查找包含
// web/index.html 的目录作为资源根，避免静态资源与 panels 清单全部落空。
func ResolvePaths() (Paths, error) {
	execPath, err := os.Executable()
	if err != nil {
		return Paths{}, err
	}
	execDir := filepath.Dir(execPath)

	dataRoot := os.Getenv("MATOGA_DATA_ROOT")
	if dataRoot == "" {
		dataRoot = execDir
	}
	presetRoot := os.Getenv("MATOGA_PRESET_ROOT")
	if presetRoot == "" {
		presetRoot = dataRoot
	}
	return Paths{
		ResRoot:    resolveResRoot(execDir),
		DataRoot:   dataRoot,
		PresetRoot: presetRoot,
	}, nil
}

// resolveResRoot 返回资源根目录。
//
// 查找顺序：
//  1. execDir 本身是资源根
//  2. 当前工作目录向上（`go run ./cmd/matoga` 时二进制约在系统临时目录，
//     而工作目录正是项目根；先查 cwd 能让开发态与打包态都正确）
//  3. execDir 向上最多 6 级
//
// 全部未命中时退回 execDir。
func resolveResRoot(execDir string) string {
	if isResRoot(execDir) {
		return execDir
	}
	if wd, err := os.Getwd(); err == nil {
		if dir := walkUpForResRoot(wd, 6); dir != "" {
			return dir
		}
	}
	if dir := walkUpForResRoot(execDir, 6); dir != "" {
		return dir
	}
	return execDir
}

// walkUpForResRoot 从 start 起向上最多 depth 级查找资源根。
func walkUpForResRoot(start string, depth int) string {
	dir := start
	for i := 0; i <= depth; i++ {
		if isResRoot(dir) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// isResRoot 判断 dir 是否是资源根（存在 web 目录）。
func isResRoot(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "web"))
	return err == nil && info.IsDir()
}
