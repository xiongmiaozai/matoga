// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package fsx

import "os"

// OpResult 是文件操作结果，字段与 Node 版 file-service 一致。
type OpResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// CreateFolder 递归创建目录；失败不返回 error，而是 success=false（沿用 Node 语义）。
func CreateFolder(p string) (OpResult, error) {
	if err := os.MkdirAll(p, 0o755); err != nil {
		return OpResult{Success: false, Error: err.Error()}, nil
	}
	return OpResult{Success: true}, nil
}
