// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package syncjob

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
)

// collector 收集事件并支持按类型筛选。
type collector struct {
	mu     sync.Mutex
	events []any
	doneCh chan struct{}
}

func newCollector() *collector {
	return &collector{doneCh: make(chan struct{})}
}

func (c *collector) emit(evt any) {
	c.mu.Lock()
	c.events = append(c.events, evt)
	c.mu.Unlock()
	if _, ok := evt.(Done); ok {
		select {
		case <-c.doneCh:
		default:
			close(c.doneCh)
		}
	}
}

func (c *collector) waitDone(t *testing.T, timeout time.Duration) Done {
	t.Helper()
	select {
	case <-c.doneCh:
	case <-time.After(timeout):
		t.Fatalf("等待 done 超时（%v）", timeout)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := len(c.events) - 1; i >= 0; i-- {
		if d, ok := c.events[i].(Done); ok {
			return d
		}
	}
	t.Fatal("未找到 done 事件")
	return Done{}
}

func (c *collector) progressList() []Progress {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []Progress
	for _, e := range c.events {
		if p, ok := e.(Progress); ok {
			out = append(out, p)
		}
	}
	return out
}

// setupRoot 创建临时目录并注册为信任根。
func setupRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	fsx.Trust(dir)
	return dir
}

func TestExecuteCopiesAllPairs(t *testing.T) {
	dir := setupRoot(t)
	pairs := make([]Pair, 0, 3)
	for i := 0; i < 3; i++ {
		src := filepath.Join(dir, "src"+string(rune('a'+i))+".txt")
		dest := filepath.Join(dir, "dst"+string(rune('a'+i))+".txt")
		if err := os.WriteFile(src, []byte("content"), 0o644); err != nil {
			t.Fatal(err)
		}
		pairs = append(pairs, Pair{Src: src, Dest: dest, Name: "f" + string(rune('a'+i))})
	}

	r := NewRunner()
	c := newCollector()
	r.Execute("j1", pairs, c.emit)
	d := c.waitDone(t, 5*time.Second)

	if d.OK != 3 || d.Fail != 0 {
		t.Errorf("done: ok=%d fail=%d, want 3/0", d.OK, d.Fail)
	}
	if d.Cancelled {
		t.Error("不应标记 cancelled")
	}
	progs := c.progressList()
	if len(progs) != 3 {
		t.Fatalf("progress 数量 = %d, want 3", len(progs))
	}
	// 进度必须是递增的 current
	for i, p := range progs {
		if p.Current != i+1 {
			t.Errorf("第 %d 条 progress.current = %d, want %d", i, p.Current, i+1)
		}
		if p.Status != "ok" {
			t.Errorf("第 %d 条 status = %q, want ok", i, p.Status)
		}
		if p.Total != 3 {
			t.Errorf("total = %d, want 3", p.Total)
		}
	}
	// 文件确实落地
	for i := 0; i < 3; i++ {
		dest := filepath.Join(dir, "dst"+string(rune('a'+i))+".txt")
		if _, err := os.Stat(dest); err != nil {
			t.Errorf("目标文件未生成: %s", dest)
		}
	}
}

func TestExecuteBackupBeforeCopy(t *testing.T) {
	dir := setupRoot(t)
	src := filepath.Join(dir, "s.txt")
	dest := filepath.Join(dir, "d.txt")
	if err := os.WriteFile(src, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	r := NewRunner()
	c := newCollector()
	r.Execute("jb", []Pair{{Src: src, Dest: dest, Backup: dest, Name: "f"}}, c.emit)
	d := c.waitDone(t, 5*time.Second)

	if d.OK != 1 {
		t.Fatalf("ok = %d, want 1", d.OK)
	}
	progs := c.progressList()
	if len(progs) != 1 {
		t.Fatalf("progress = %d, want 1", len(progs))
	}
	if progs[0].BackupPath == "" {
		t.Error("带 backup 时应返回 backupPath")
	}
	if _, err := os.Stat(progs[0].BackupPath); err != nil {
		t.Errorf("备份文件不存在: %s", progs[0].BackupPath)
	}
	// 备份的内容应是原本的 old
	got, err := os.ReadFile(progs[0].BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "old" {
		t.Errorf("备份内容 = %q, want %q", string(got), "old")
	}
}

func TestExecuteCancelBetweenItems(t *testing.T) {
	dir := setupRoot(t)
	const n = 60
	pairs := make([]Pair, 0, n)
	big := make([]byte, 512*1024)
	for i := 0; i < n; i++ {
		src := filepath.Join(dir, "s"+string(rune('A'+i%26))+string(rune('0'+i/26))+".bin")
		if err := os.WriteFile(src, big, 0o644); err != nil {
			t.Fatal(err)
		}
		pairs = append(pairs, Pair{
			Src:  src,
			Dest: filepath.Join(dir, "d"+string(rune('A'+i%26))+string(rune('0'+i/26))+".bin"),
			Name: "b",
		})
	}

	r := NewRunner()
	c := newCollector()
	// 收到第一条 progress 后立刻取消
	go func() {
		deadline := time.After(5 * time.Second)
		for {
			select {
			case <-deadline:
				return
			case <-time.After(time.Millisecond):
				if len(c.progressList()) > 0 {
					r.Cancel("jc")
					return
				}
			}
		}
	}()

	r.Execute("jc", pairs, c.emit)
	d := c.waitDone(t, 15*time.Second)

	if !d.Cancelled {
		t.Fatal("应标记 cancelled=true")
	}
	if d.OK >= n {
		t.Errorf("已处理 %d 项，取消未生效（应少于 %d）", d.OK, n)
	}
}

func TestExecuteNoPairs(t *testing.T) {
	r := NewRunner()
	c := newCollector()
	r.Execute("j0", nil, c.emit)
	d := c.waitDone(t, 3*time.Second)
	if d.OK != 0 || d.Fail != 0 || d.Cancelled {
		t.Errorf("空任务 done = %+v，应为全零", d)
	}
	if len(c.progressList()) != 0 {
		t.Error("空任务不应产生 progress")
	}
}

func TestExecuteFailDoesNotAbort(t *testing.T) {
	dir := setupRoot(t)
	good := filepath.Join(dir, "g.txt")
	if err := os.WriteFile(good, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 中间一项源文件不存在 → 应计 fail 但继续处理后面的项
	pairs := []Pair{
		{Src: good, Dest: filepath.Join(dir, "d1.txt"), Name: "ok1"},
		{Src: filepath.Join(dir, "missing.txt"), Dest: filepath.Join(dir, "d2.txt"), Name: "bad"},
		{Src: good, Dest: filepath.Join(dir, "d3.txt"), Name: "ok2"},
	}

	r := NewRunner()
	c := newCollector()
	r.Execute("jf", pairs, c.emit)
	d := c.waitDone(t, 5*time.Second)

	if d.OK != 2 || d.Fail != 1 {
		t.Errorf("done: ok=%d fail=%d, want 2/1", d.OK, d.Fail)
	}
	progs := c.progressList()
	if len(progs) != 3 {
		t.Fatalf("progress = %d, want 3（失败不应中断后续项）", len(progs))
	}
	if progs[1].Status == "ok" {
		t.Error("缺失源文件的项不应标记 ok")
	}
}

func TestCancelUnknownJob(t *testing.T) {
	r := NewRunner()
	if r.Cancel("nope") {
		t.Error("取消不存在的任务应返回 false")
	}
	if n := r.CancelAll(); n != 0 {
		t.Errorf("CancelAll = %d, want 0", n)
	}
}
