// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// ── upload ──

func TestUploadBeginPutEnd(t *testing.T) {
	e := newEnv(t)

	// begin
	d := data(t, e.do(t, "POST", "/api/upload/begin", nil))
	uploadID, _ := d["uploadId"].(string)
	if uploadID == "" {
		t.Fatalf("uploadId 为空: %v", d)
	}
	rootPath, _ := d["rootPath"].(string)
	if rootPath == "" {
		t.Fatalf("rootPath 为空: %v", d)
	}

	// put file（请求体是原始字节）
	body := []byte("hello upload")
	req, err := http.NewRequest("PUT",
		e.srv.URL+"/api/upload/file?uploadId="+uploadID+"&path="+urlq("sub/a.txt"),
		bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("PUT file: %v", err)
	}
	defer res.Body.Close()
	var putResp map[string]any
	if err := json.NewDecoder(res.Body).Decode(&putResp); err != nil {
		t.Fatal(err)
	}
	if putResp["ok"] != true {
		t.Fatalf("上传失败: %v", putResp)
	}

	// 文件应真实落盘
	got, err := os.ReadFile(filepath.Join(rootPath, "sub", "a.txt"))
	if err != nil {
		t.Fatalf("文件未落盘: %v", err)
	}
	if string(got) != "hello upload" {
		t.Errorf("内容 = %q, want hello upload", got)
	}

	// end
	d = data(t, e.do(t, "POST", "/api/upload/end?uploadId="+uploadID, nil))
	if d["rootPath"] != rootPath {
		t.Errorf("end rootPath = %v, want %v", d["rootPath"], rootPath)
	}
}

func TestUploadUnknownID(t *testing.T) {
	e := newEnv(t)
	raw := e.do(t, "POST", "/api/upload/end?uploadId=nope", nil)
	if okv, _ := raw["ok"].(bool); okv {
		t.Error("未知 uploadId 应报错")
	}
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("code = %v, want ERR_INVALID_PARAM", raw["code"])
	}
}

func TestUploadRejectsTraversal(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.do(t, "POST", "/api/upload/begin", nil))
	uploadID, _ := d["uploadId"].(string)

	for _, bad := range []string{"../evil.txt", "a/../../evil.txt", `..\evil.txt`} {
		req, err := http.NewRequest("PUT",
			e.srv.URL+"/api/upload/file?uploadId="+uploadID+"&path="+urlq(bad),
			bytes.NewReader([]byte("x")))
		if err != nil {
			t.Fatal(err)
		}
		res, err := e.srv.Client().Do(req)
		if err != nil {
			t.Fatalf("PUT %q: %v", bad, err)
		}
		var body map[string]any
		_ = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		if body["ok"] == true {
			t.Errorf("路径 %q 应被拒绝", bad)
		}
	}
}

// ── compare ──

func TestCompareScan(t *testing.T) {
	e := newEnv(t)
	dir := filepath.Join(e.dir, "scanme")
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"a.png", "b.txt", "sub/c.png"} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(n)), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// 非递归：a.png + b.txt + sub 目录 = 3 条
	d := data(t, e.do(t, "POST", "/api/compare/scan", map[string]any{"path": dir}))
	entries, _ := d["entries"].([]any)
	if len(entries) != 3 {
		t.Errorf("非递归条目 = %d, want 3 (2 文件 + sub 目录)", len(entries))
	}

	// 递归：a.png + b.txt + sub + sub/c.png = 4 条
	d = data(t, e.do(t, "POST", "/api/compare/scan", map[string]any{"path": dir, "recursive": true}))
	entries, _ = d["entries"].([]any)
	if len(entries) != 4 {
		t.Errorf("递归条目 = %d, want 4", len(entries))
	}

	// ignore 模式：忽略 *.txt 后剩 a.png + sub = 2 条
	d = data(t, e.do(t, "POST", "/api/compare/scan", map[string]any{
		"path": dir, "ignore": []string{"*.txt"},
	}))
	entries, _ = d["entries"].([]any)
	if len(entries) != 2 {
		t.Errorf("忽略 *.txt 后条目 = %d, want 2", len(entries))
	}
	for _, e := range entries {
		m, _ := e.(map[string]any)
		if m["name"] == "b.txt" {
			t.Error("b.txt 应被忽略")
		}
	}
}

func TestCompareScanNotFound(t *testing.T) {
	e := newEnv(t)
	raw := e.do(t, "POST", "/api/compare/scan", map[string]any{
		"path": filepath.Join(e.dir, "nope"),
	})
	if okv, _ := raw["ok"].(bool); okv {
		t.Error("不存在目录应报错")
	}
}

// ── panels ──

func TestPanelsEmpty(t *testing.T) {
	e := newEnv(t)
	// panels 目录不存在 → 空清单而不是报错
	raw := e.get(t, "/api/panels")
	if okv, _ := raw["ok"].(bool); !okv {
		t.Fatalf("应返回 ok=true: %v", raw)
	}
	panels, _ := raw["panels"].([]any)
	if len(panels) != 0 {
		t.Errorf("panels = %d, want 0", len(panels))
	}
}

func TestPanelsList(t *testing.T) {
	e := newEnv(t)
	// 造两个面板，order 分别为 2 和 1
	mk := func(id string, manifest map[string]any) {
		d := filepath.Join(e.panelsDir, id)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		buf, _ := json.Marshal(manifest)
		if err := os.WriteFile(filepath.Join(d, "manifest.json"), buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mk("second", map[string]any{
		"id": "p2", "title": "面板二", "order": 2,
		"html": "index.html", "js": "index.js", "css": "style.css",
	})
	mk("first", map[string]any{
		"id": "p1", "title": "面板一", "order": 1,
		"html": "index.html", "deps": []string{"three"},
	})
	// 无 manifest 的目录应被跳过
	if err := os.MkdirAll(filepath.Join(e.panelsDir, "nomanifest"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 损坏的 manifest 应被跳过
	bad := filepath.Join(e.panelsDir, "broken")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bad, "manifest.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	raw := e.get(t, "/api/panels")
	panels, _ := raw["panels"].([]any)
	if len(panels) != 2 {
		t.Fatalf("panels = %d, want 2 (%v)", len(panels), panels)
	}
	// 按 order 升序：p1 在前
	first, _ := panels[0].(map[string]any)
	if first["id"] != "p1" {
		t.Errorf("首个面板 id = %v, want p1", first["id"])
	}
	if first["htmlUrl"] != "/src/panels/first/index.html" {
		t.Errorf("htmlUrl = %v", first["htmlUrl"])
	}
	if first["jsUrl"] != nil {
		t.Errorf("无 js 时 jsUrl 应为 null, got %v", first["jsUrl"])
	}
	if first["mount"] != "body" {
		t.Errorf("mount = %v, want body", first["mount"])
	}

	second, _ := panels[1].(map[string]any)
	if second["cssUrl"] != "/src/panels/second/style.css" {
		t.Errorf("cssUrl = %v", second["cssUrl"])
	}
	if second["order"].(float64) != 2 {
		t.Errorf("order = %v, want 2", second["order"])
	}
}
