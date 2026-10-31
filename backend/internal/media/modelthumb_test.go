// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

// tinyPNG 是一个 1x1 PNG 的 base64（不含 data: 前缀）。
const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func dataURL(b64 string) string { return "data:image/png;base64," + b64 }

func TestModelThumbKindFor(t *testing.T) {
	cases := map[string]string{
		"im:123":                            "imported",
		"cm:abc":                            "custom",
		"packmodel:mc:MyPack/assets/a.json": "mc",
		"packmodel:official:Vanilla/x.json": "mc",
		"bb:whatever":                       "misc",
		"":                                  "misc",
	}
	for k, want := range cases {
		if got := ModelThumbKindFor(k); got != want {
			t.Errorf("ModelThumbKindFor(%q) = %q, want %q", k, got, want)
		}
	}
}

func TestModelThumbSaveAndInfo(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "im:42"

	// 初始：不存在且 stale
	info := m.Info(key, 1000)
	if info.Exists {
		t.Error("初始不应存在")
	}
	if !info.Stale {
		t.Error("初始应为 stale")
	}
	if info.Renderer != ModelThumbRendererVersion {
		t.Errorf("renderer = %d, want %d", info.Renderer, ModelThumbRendererVersion)
	}
	if info.FrameCount != 1 {
		t.Errorf("frameCount = %d, want 1", info.FrameCount)
	}

	// 保存单帧
	res := m.Save(key, 1000, SavePayload{DataURL: dataURL(tinyPNG)})
	if !res.Success {
		t.Fatalf("保存失败: %s", res.Error)
	}
	if res.FrameCount != 1 {
		t.Errorf("frameCount = %d, want 1", res.FrameCount)
	}

	// 保存后：存在且不 stale（mtime 相同）
	info = m.Info(key, 1000)
	if !info.Exists {
		t.Error("保存后应存在")
	}
	if info.Stale {
		t.Error("mtime 相同不应 stale")
	}
	if info.CachedMtime != 1000 {
		t.Errorf("cachedMtime = %v, want 1000", info.CachedMtime)
	}

	// 源 mtime 变新 → stale
	if info = m.Info(key, 2000); !info.Stale {
		t.Error("源 mtime 更新后应 stale")
	}

	// PNG 真实落盘到 imported 子目录
	p := m.Path(key, 0)
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("PNG 未落盘: %v", err)
	}
	if filepath.Base(filepath.Dir(p)) != "imported" {
		t.Errorf("目录 = %s, want imported", filepath.Base(filepath.Dir(p)))
	}
}

func TestModelThumbMultiFrame(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "packmodel:mc:Pack/assets/minecraft/models/block/x.json"

	frames := []SaveFrame{
		{DataURL: dataURL(tinyPNG), Delay: 120},
		{DataURL: dataURL(tinyPNG), Delay: 0},
		{DataURL: dataURL(tinyPNG), Delay: 0},
	}
	res := m.Save(key, 500, SavePayload{Frames: frames})
	if !res.Success {
		t.Fatalf("多帧保存失败: %s", res.Error)
	}
	if res.FrameCount != 3 {
		t.Errorf("frameCount = %d, want 3", res.FrameCount)
	}
	if res.FrameDelay != 120 {
		t.Errorf("frameDelay = %d, want 120", res.FrameDelay)
	}

	info := m.Info(key, 500)
	if info.FrameCount != 3 || info.FrameDelay != 120 {
		t.Errorf("info frameCount=%d frameDelay=%d, want 3/120", info.FrameCount, info.FrameDelay)
	}

	// 帧 0 走无后缀路径，帧 i>0 带 .f<i>
	if _, err := os.Stat(m.Path(key, 0)); err != nil {
		t.Errorf("帧 0 未落盘: %v", err)
	}
	if _, err := os.Stat(m.Path(key, 2)); err != nil {
		t.Errorf("帧 2 未落盘: %v", err)
	}
	if filepath.Base(m.Path(key, 2)) == filepath.Base(m.Path(key, 0)) {
		t.Error("帧 2 与帧 0 不应同路径")
	}
}

func TestModelThumbShrinkFrames(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "cm:1"

	// 先写 3 帧
	m.Save(key, 1, SavePayload{Frames: []SaveFrame{
		{DataURL: dataURL(tinyPNG)}, {DataURL: dataURL(tinyPNG)}, {DataURL: dataURL(tinyPNG)},
	}})
	if _, err := os.Stat(m.Path(key, 2)); err != nil {
		t.Fatal("帧 2 应存在")
	}

	// 再写 1 帧 → 多余帧应被清除
	res := m.Save(key, 2, SavePayload{DataURL: dataURL(tinyPNG)})
	if !res.Success {
		t.Fatalf("保存失败: %s", res.Error)
	}
	if _, err := os.Stat(m.Path(key, 2)); !os.IsNotExist(err) {
		t.Error("帧 2 应被清除")
	}
	if info := m.Info(key, 2); info.FrameCount != 1 {
		t.Errorf("frameCount = %d, want 1", info.FrameCount)
	}
}

func TestModelThumbRejectsBadPayload(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "im:bad"

	// 非 data:image/ 前缀
	if r := m.Save(key, 1, SavePayload{DataURL: "not-a-data-url"}); r.Success {
		t.Error("非法 dataUrl 应失败")
	}
	// 空内容
	if r := m.Save(key, 1, SavePayload{DataURL: "data:image/png;base64,"}); r.Success {
		t.Error("空 base64 应失败")
	}
	// 非法 base64
	if r := m.Save(key, 1, SavePayload{DataURL: "data:image/png;base64,!!!!"}); r.Success {
		t.Error("非法 base64 应失败")
	}
	// 帧数超上限应截断而不是失败
	many := make([]SaveFrame, 0, 20)
	for i := 0; i < 20; i++ {
		many = append(many, SaveFrame{DataURL: dataURL(tinyPNG)})
	}
	r := m.Save(key, 1, SavePayload{Frames: many})
	if !r.Success {
		t.Fatalf("超帧数应截断成功: %s", r.Error)
	}
	if r.FrameCount != ModelThumbMaxFrames {
		t.Errorf("frameCount = %d, want %d", r.FrameCount, ModelThumbMaxFrames)
	}
}

func TestModelThumbInvalidate(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "im:7"
	m.Save(key, 1, SavePayload{DataURL: dataURL(tinyPNG)})
	if _, err := os.Stat(m.Path(key, 0)); err != nil {
		t.Fatal("PNG 应存在")
	}
	m.Invalidate(key)
	if _, err := os.Stat(m.Path(key, 0)); !os.IsNotExist(err) {
		t.Error("Invalidate 后 PNG 应被删除")
	}
	if info := m.Info(key, 1); info.Exists {
		t.Error("Invalidate 后不应存在")
	}
}

func TestModelThumbOldRendererIsStale(t *testing.T) {
	dir := t.TempDir()
	m := NewModelThumb(dir)
	key := "im:9"
	m.Save(key, 100, SavePayload{DataURL: dataURL(tinyPNG)})

	// 手动把 sidecar 的 renderer 改成旧版本
	metaPath := m.metaPathFor(key)
	if err := os.WriteFile(metaPath, []byte(`{"mtime":100,"renderer":1,"frameCount":1,"frameDelay":0}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if info := m.Info(key, 100); !info.Stale {
		t.Error("旧渲染器版本的缓存应判 stale")
	}
}

func TestParseFrameParam(t *testing.T) {
	cases := map[string]int{"0": 0, "3": 3, "7": 7, "8": 0, "-1": 0, "": 0, "abc": 0, "999": 0}
	for in, want := range cases {
		if got := ParseFrameParam(in); got != want {
			t.Errorf("ParseFrameParam(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestDecodeTinyPNG(t *testing.T) {
	// 确认测试用的 base64 是合法 PNG，避免测试数据本身有问题
	bin, err := base64.StdEncoding.DecodeString(tinyPNG)
	if err != nil {
		t.Fatalf("tinyPNG 不是合法 base64: %v", err)
	}
	if len(bin) < 8 || string(bin[1:4]) != "PNG" {
		t.Errorf("tinyPNG 不是 PNG 数据: % x", bin[:min(8, len(bin))])
	}
}
