// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

// Package syncjob 执行批量复制任务：串行 backup→copy，支持取消，逐项发进度。
//
// 与 Node 侧 server/services/sync-service.js 行为对齐：
//   - 串行执行，不并发（避免同时写同一目标）
//   - 每项先备份（若指定）再复制
//   - 任一项失败只计数不中止
//   - 取消只在项与项之间生效，不会打断进行中的单次复制
package syncjob

import (
	"sync"
	"sync/atomic"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
)

// Pair 是一次复制的输入。
type Pair struct {
	Src    string `json:"src"`
	Dest   string `json:"dest"`
	Backup string `json:"backup"`
	Name   string `json:"name"`
}

// Progress 是逐项进度事件，字段与 Node 版一致。
type Progress struct {
	Type       string `json:"type"`
	JobID      string `json:"jobId"`
	Current    int    `json:"current"`
	Total      int    `json:"total"`
	OK         int    `json:"ok"`
	Fail       int    `json:"fail"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	BackupPath string `json:"backupPath,omitempty"`
	Dest       string `json:"dest,omitempty"`
	Error      string `json:"error,omitempty"`
}

// Done 是任务结束事件。
type Done struct {
	Type      string `json:"type"`
	JobID     string `json:"jobId"`
	OK        int    `json:"ok"`
	Fail      int    `json:"fail"`
	Cancelled bool   `json:"cancelled"`
	Error     string `json:"error,omitempty"`
}

// Emitter 接收进度与结束事件。实现方负责是否真正发送（如 ws 已断开）。
type Emitter func(evt any)

// job 是运行中的任务句柄。
type job struct {
	cancelled atomic.Bool
}

// Runner 管理所有进行中的任务，支持按 jobId 取消。
type Runner struct {
	mu   sync.Mutex
	jobs map[string]*job
}

// NewRunner 创建执行器。
func NewRunner() *Runner {
	return &Runner{jobs: make(map[string]*job)}
}

// Execute 异步执行一个任务，立即返回。
//
// emit 会在任务 goroutine 中被调用，实现方需自行处理并发写。
func (r *Runner) Execute(jobID string, pairs []Pair, emit Emitter) {
	h := &job{}
	r.mu.Lock()
	r.jobs[jobID] = h
	r.mu.Unlock()

	go func() {
		var ok, fail int
		cancelled := false

		for i, p := range pairs {
			if h.cancelled.Load() {
				cancelled = true
				break
			}

			bkPath, status, errMsg, destOut := r.runOne(p)
			switch status {
			case "ok":
				ok++
			default:
				fail++
			}

			emit(Progress{
				Type:       "progress",
				JobID:      jobID,
				Current:    i + 1,
				Total:      len(pairs),
				OK:         ok,
				Fail:       fail,
				Name:       p.Name,
				Status:     status,
				BackupPath: bkPath,
				Dest:       destOut,
				Error:      errMsg,
			})
		}

		emit(Done{Type: "done", JobID: jobID, OK: ok, Fail: fail, Cancelled: cancelled})

		r.mu.Lock()
		delete(r.jobs, jobID)
		r.mu.Unlock()
	}()
}

// runOne 处理单项：备份（可选）→ 复制。
//
// 返回 (备份路径, 状态, 错误码, 目标路径)。状态取值与 Node 版一致：
//   - ok          复制成功
//   - backup_fail 备份失败（不再尝试复制）
//   - copy_fail   复制返回失败
//   - error       路径校验或执行期异常
func (r *Runner) runOne(p Pair) (backupPath, status, errMsg, destOut string) {
	var bkPath string

	if p.Backup != "" {
		bp, err := fsx.GuardWrite(p.Backup)
		if err != nil {
			return "", "error", err.Error(), ""
		}
		bk := fsx.BackupFile(bp)
		if !bk.Success {
			return "", "backup_fail", bk.Error, ""
		}
		bkPath = bk.BackupPath
	}

	src, err := fsx.GuardRead(p.Src)
	if err != nil {
		return bkPath, "error", err.Error(), ""
	}
	dest, err := fsx.GuardWrite(p.Dest)
	if err != nil {
		return bkPath, "error", err.Error(), ""
	}

	res := fsx.CopyFile(src, dest)
	if !res.Success {
		return bkPath, "copy_fail", res.Error, dest
	}
	fsx.InvalidateHash(dest)
	return bkPath, "ok", "", dest
}

// Cancel 请求取消某个任务；任务不存在时返回 false。
func (r *Runner) Cancel(jobID string) bool {
	r.mu.Lock()
	h, ok := r.jobs[jobID]
	r.mu.Unlock()
	if !ok {
		return false
	}
	h.cancelled.Store(true)
	return true
}

// CancelAll 请求取消全部任务，返回任务数。
func (r *Runner) CancelAll() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, h := range r.jobs {
		h.cancelled.Store(true)
	}
	return len(r.jobs)
}

// Active 返回进行中的任务数，供健康检查/诊断使用。
func (r *Runner) Active() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.jobs)
}
