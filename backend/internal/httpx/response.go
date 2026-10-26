// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package httpx 提供统一响应、错误码与中间件。
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
)

// 错误码，与 Node 版 core/errors.js 保持逐字一致，前端按 code 分支。
const (
	CodeInvalidParam   = "ERR_INVALID_PARAM"
	CodePathDenied     = "ERR_PATH_DENIED"
	CodeFSNotFound     = "ERR_FS_NOT_FOUND"
	CodeNotFound       = "ERR_NOT_FOUND"
	CodeFS             = "ERR_FS"
	CodeAlreadyExists  = "ERR_ALREADY_EXISTS"
	CodeMcNotZip       = "ERR_MC_NOT_ZIP"
	CodeMcBadMcmeta    = "ERR_MC_BAD_MCMETA"
	CodeCancelled      = "ERR_CANCELLED"
	CodeLanForbidden   = "ERR_LAN_FORBIDDEN"
	CodeUnauthorized   = "ERR_UNAUTHORIZED"
	CodeUnknown        = "ERR_UNKNOWN"
)

// AppError 是带业务错误码的错误。
type AppError struct {
	Code string
	Msg  string
}

func (e *AppError) Error() string { return e.Msg }

// Errorf 构造 AppError。
func Errorf(code, msg string) *AppError { return &AppError{Code: code, Msg: msg} }

// OK 写入 `{"ok":true,"data":...}`。
func OK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

// Fail 写入 `{"ok":false,"code":...,"msg":...}`。
func Fail(w http.ResponseWriter, code, msg string) {
	if msg == "" {
		msg = code
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": false, "code": code, "msg": msg})
}

// FailErr 从 error 推断错误码并写入失败响应。
func FailErr(w http.ResponseWriter, err error) {
	var ae *AppError
	if errors.As(err, &ae) {
		Fail(w, ae.Code, ae.Msg)
		return
	}
	Fail(w, CodeUnknown, err.Error())
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Handler 是带 error 返回的处理器，省掉每处手写响应。
type Handler func(w http.ResponseWriter, r *http.Request) error

// Wrap 把 Handler 适配成 http.HandlerFunc，统一错误处理。
func Wrap(h Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			FailErr(w, err)
		}
	}
}
