// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/xiongmiaozai/matoga/backend/internal/syncjob"
)

// wsInbound 是客户端发来的消息。
type wsInbound struct {
	Type  string         `json:"type"`
	JobID string         `json:"jobId"`
	Pairs []syncjob.Pair `json:"pairs"`
}

const (
	wsReadLimit = 32 << 20 // 32 MiB：批量复制可能带大量 pairs
	wsWriteWait = 10 * time.Second
)

// WSHandler 提供 /api/ws 的批量复制进度通道。
//
// 协议与 Node 侧 server/ws.js 完全一致：
//
//	client → server: {type:'sync', jobId, pairs:[{src,dest,backup,name}]}
//	client → server: {type:'cancel', jobId}
//	server → client: {type:'progress', jobId, current, total, ok, fail, name, status, backupPath?}
//	server → client: {type:'done', jobId, ok, fail, cancelled}
type WSHandler struct {
	Runner   *syncjob.Runner
	TokenFor func() string // 返回当前期望的 token；空表示不鉴权
}

// wsConn 封装一个连接的状态：写锁 + 活跃任务集合。
//
// websocket 连接不支持并发写，因此所有发送都经 writeMu 串行。
// 活跃任务集合需要跨 goroutine 访问（读循环写入、任务回调删除），用 mu 保护。
type wsConn struct {
	c       *websocket.Conn
	ctx     context.Context
	writeMu sync.Mutex

	mu     sync.Mutex
	active map[string]struct{}
}

// send 串行发送一条 JSON 消息。失败静默忽略（连接可能已断）。
func (w *wsConn) send(evt any) {
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(w.ctx, wsWriteWait)
	defer cancel()
	_ = w.c.Write(wctx, websocket.MessageText, data)
}

// addActive / dropActive / snapshotActive 维护活跃任务集合。
func (w *wsConn) addActive(id string) {
	w.mu.Lock()
	w.active[id] = struct{}{}
	w.mu.Unlock()
}

func (w *wsConn) dropActive(id string) {
	w.mu.Lock()
	delete(w.active, id)
	w.mu.Unlock()
}

func (w *wsConn) snapshotActive() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]string, 0, len(w.active))
	for id := range w.active {
		out = append(out, id)
	}
	return out
}

// Serve 处理 GET /api/ws。
func (h *WSHandler) Serve(w http.ResponseWriter, r *http.Request) error {
	// 鉴权与 Node 版一致：token 非空时校验 ?token=，不匹配则 1008 关闭。
	if expected := h.token(); expected != "" && r.URL.Query().Get("token") != expected {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err == nil {
			_ = c.Close(websocket.StatusPolicyViolation, "unauthorized")
		}
		return nil
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// 本项目是本地工具，页面与 WS 同源。InsecureSkipVerify 与 Node ws 库
		// 「默认不校验 Origin」的行为对齐，避免 Electron / 自定义协议下握手被拒。
		InsecureSkipVerify: true,
	})
	if err != nil {
		return nil // Accept 已写回错误响应
	}
	c.SetReadLimit(wsReadLimit)

	conn := &wsConn{c: c, ctx: r.Context(), active: make(map[string]struct{})}

	// 连接关闭时取消其所有任务（对齐 Node 的 ws.on('close')）。
	defer func() {
		for _, id := range conn.snapshotActive() {
			h.Runner.Cancel(id)
		}
		_ = c.CloseNow()
	}()

	for {
		typ, data, err := c.Read(conn.ctx)
		if err != nil {
			return nil // 客户端关闭或读超时
		}
		if typ != websocket.MessageText {
			continue
		}

		var msg wsInbound
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // 与 Node 版一致：坏消息静默忽略
		}

		switch msg.Type {
		case "sync":
			jobID := msg.JobID
			if jobID == "" {
				jobID = "job-" + strconv.FormatInt(time.Now().UnixNano(), 10)
			}
			if len(msg.Pairs) == 0 {
				conn.send(syncjob.Done{Type: "done", JobID: jobID, Error: "no pairs"})
				continue
			}
			conn.addActive(jobID)
			go h.Runner.Execute(jobID, msg.Pairs, func(evt any) {
				if _, ok := evt.(syncjob.Done); ok {
					conn.dropActive(jobID)
				}
				conn.send(evt)
			})

		case "cancel":
			h.Runner.Cancel(msg.JobID)
		}
	}
}

// token 安全求值 TokenFor。
func (h *WSHandler) token() string {
	if h.TokenFor == nil {
		return ""
	}
	return h.TokenFor()
}
