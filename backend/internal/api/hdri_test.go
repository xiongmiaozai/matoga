// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeMinimalHDR 在目录写一个 2x1 的未压缩 Radiance HDR。
func writeMinimalHDR(t *testing.T, dir, name string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	content := "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n" +
		string([]byte{128, 64, 32, 129, 255, 128, 64, 130})
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestHDRIListAndThumbFlow(t *testing.T) {
	e := newEnv(t)
	// 把 HDR 预设目录指到临时目录
	e.do(t, http.MethodPut, "/api/config", map[string]any{"hdriPresetPath": e.dir})

	hdrPath := writeMinimalHDR(t, e.dir, "studio.hdr")
	// 非 HDR 扩展名不应出现在列表里
	_ = os.WriteFile(filepath.Join(e.dir, "ignore.png"), []byte("x"), 0o644)

	d := data(t, e.get(t, "/api/hdri/list"))
	entries, _ := d["entries"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1 (%v)", len(entries), d["entries"])
	}
	first, _ := entries[0].(map[string]any)
	if first["name"] != "studio.hdr" {
		t.Errorf("name = %v", first["name"])
	}

	// 缩略图尚未生成
	d = data(t, e.get(t, "/api/hdri/thumb-info?path="+urlQuery(hdrPath)))
	if d["exists"] != false {
		t.Errorf("初始 exists = %v, want false", d["exists"])
	}
	if !strings.HasPrefix(d["thumbUrl"].(string), "/api/hdri/thumb?path=") {
		t.Errorf("thumbUrl = %v", d["thumbUrl"])
	}

	// GET /thumb 会即时生成 PNG
	res, err := http.Get(e.srv.URL + "/api/hdri/thumb?path=" + urlQuery(hdrPath))
	if err != nil {
		t.Fatal(err)
	}
	pngBytes, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if len(pngBytes) < 8 || !bytes.Equal(pngBytes[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		t.Fatalf("返回的不是 PNG（%d 字节）", len(pngBytes))
	}

	// 生成后 meta 里应有 blurhash
	d = data(t, e.get(t, "/api/hdri/thumb-info?path="+urlQuery(hdrPath)))
	if d["exists"] != true {
		t.Errorf("生成后 exists = %v", d["exists"])
	}
	if bh, _ := d["blurhash"].(string); bh == "" {
		t.Errorf("blurhash 为空: %v", d["blurhash"])
	}
}

func TestHDRISaveThumbAndCleanup(t *testing.T) {
	e := newEnv(t)
	e.do(t, http.MethodPut, "/api/config", map[string]any{"hdriPresetPath": e.dir})
	hdrPath := writeMinimalHDR(t, e.dir, "a.hdr")

	payload := base64.StdEncoding.EncodeToString([]byte("fake-png"))
	d := data(t, e.postJSON(t, "/api/hdri/thumb", map[string]any{
		"path":    hdrPath,
		"dataUrl": "data:image/png;base64," + payload,
	}))
	if d["success"] != true {
		t.Fatalf("保存失败: %v", d)
	}

	// 非法 dataUrl
	resp := e.postJSON(t, "/api/hdri/thumb", map[string]any{"path": hdrPath, "dataUrl": "nope"})
	if resp["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("非法 dataUrl 错误码 = %v", resp["code"])
	}

	// 清理：删除 HDR 后其缩略图应被移除
	if err := os.Remove(hdrPath); err != nil {
		t.Fatal(err)
	}
	d = data(t, e.postJSON(t, "/api/hdri/cleanup", nil))
	if d["valid"].(float64) != 0 {
		t.Errorf("valid = %v, want 0", d["valid"])
	}
	if d["removed"].(float64) < 1 {
		t.Errorf("removed = %v, want >= 1", d["removed"])
	}
}

func TestHDRIListUnreadableDir(t *testing.T) {
	e := newEnv(t)
	e.do(t, http.MethodPut, "/api/config", map[string]any{
		"hdriPresetPath": filepath.Join(e.dir, "does-not-exist"),
	})
	resp := e.get(t, "/api/hdri/list")
	if resp["code"] != "ERR_FS" {
		t.Errorf("错误码 = %v, want ERR_FS", resp["code"])
	}
}
