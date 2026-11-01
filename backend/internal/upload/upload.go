// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package upload

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// UploadTTL 是上传会话的存活时间（1 小时）。
const UploadTTL = time.Hour

// session 是一个上传会话。
type session struct {
	rootPath string
	created  time.Time
}

// Service 管理分块上传会话，对齐 Node 版 upload-service.js。
//
// 上传文件先落到 data/tmp/uploads/<uploadId>/，会话超时后整目录清理。
type Service struct {
	dir      string
	mu       sync.Mutex
	sessions map[string]*session
}

// New 创建上传服务；dataRoot 为数据根目录。
func New(dataRoot string) *Service {
	return &Service{
		dir:      filepath.Join(dataRoot, "data", "tmp", "uploads"),
		sessions: make(map[string]*session),
	}
}

// Dir 返回上传根目录。
func (s *Service) Dir() string { return s.dir }

// newID 生成随机 uploadId（32 位十六进制，等价于 UUID 去横线）。
func newID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// Begin 开始一个上传会话，顺带清理超时会话。
func (s *Service) Begin() (map[string]any, error) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	for id, sess := range s.sessions {
		if now.Sub(sess.created) > UploadTTL {
			_ = os.RemoveAll(sess.rootPath)
			delete(s.sessions, id)
		}
	}

	id, err := newID()
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "生成 uploadId 失败: "+err.Error())
	}
	rootPath := filepath.Join(s.dir, id)
	if err := os.MkdirAll(rootPath, 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	s.sessions[id] = &session{rootPath: rootPath, created: now}
	return map[string]any{"uploadId": id, "rootPath": rootPath}, nil
}

// sessionOf 取会话，不存在时报错。
func (s *Service) sessionOf(uploadID string) (*session, error) {
	sess, ok := s.sessions[uploadID]
	if !ok {
		return nil, httpx.Errorf(httpx.CodeInvalidParam, "unknown uploadId")
	}
	return sess, nil
}

// SafeRel 校验相对路径，拒绝绝对路径与 .. 穿越。
func SafeRel(rel string) (string, error) {
	if rel == "" || strings.TrimSpace(rel) == "" || strings.ContainsRune(rel, 0) {
		return "", httpx.Errorf(httpx.CodeInvalidParam, "invalid relative path")
	}
	// 统一分隔符后按段检查，避免 Windows 反斜杠绕过
	n := strings.ReplaceAll(rel, "\\", "/")
	n = filepath.ToSlash(filepath.Clean(n))
	if strings.HasPrefix(n, "/") || filepath.IsAbs(n) {
		return "", httpx.Errorf(httpx.CodePathDenied, "path traversal denied")
	}
	for _, seg := range strings.Split(n, "/") {
		if seg == ".." {
			return "", httpx.Errorf(httpx.CodePathDenied, "path traversal denied")
		}
	}
	return n, nil
}

// PutFile 写入单个上传文件。
func (s *Service) PutFile(uploadID, rel string, data []byte) (map[string]any, error) {
	s.mu.Lock()
	sess, err := s.sessionOf(uploadID)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	safe, err := SafeRel(rel)
	if err != nil {
		return nil, err
	}
	dest := filepath.Join(sess.rootPath, filepath.FromSlash(safe))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, err.Error())
	}
	return map[string]any{"written": true}, nil
}

// End 结束会话，返回落盘根目录。
func (s *Service) End(uploadID string) (map[string]any, error) {
	s.mu.Lock()
	sess, err := s.sessionOf(uploadID)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return map[string]any{"rootPath": sess.rootPath}, nil
}

// Cleanup 清空整个上传目录（进程退出时调用）。
func (s *Service) Cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = os.RemoveAll(s.dir)
	s.sessions = make(map[string]*session)
}
