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
		ResRoot:    execDir,
		DataRoot:   dataRoot,
		PresetRoot: presetRoot,
	}, nil
}
