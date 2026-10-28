// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"testing"
)

// tinyPNG 是 1x1 PNG 的 base64（不含 data: 前缀）。
const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func pngDataURL() string { return "data:image/png;base64," + tinyPNG }

func TestModelThumbInfoEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/asset/model-thumb-info?key="+urlq("im:1")+"&mtime=100"))
	if d["exists"] != false {
		t.Errorf("exists = %v, want false", d["exists"])
	}
	if d["stale"] != true {
		t.Errorf("stale = %v, want true", d["stale"])
	}
	if d["renderer"].(float64) != 5 {
		t.Errorf("renderer = %v, want 5", d["renderer"])
	}
}

func TestModelThumbSaveThenGet(t *testing.T) {
	e := newEnv(t)
	key := "im:42"

	// 保存
	d := data(t, e.do(t, "POST", "/api/asset/model-thumb", map[string]any{
		"key": key, "mtime": 1000, "dataUrl": pngDataURL(),
	}))
	if d["success"] != true {
		t.Fatalf("success = %v, want true (%v)", d["success"], d)
	}
	if d["frameCount"].(float64) != 1 {
		t.Errorf("frameCount = %v, want 1", d["frameCount"])
	}

	// 查询应存在且不 stale
	d = data(t, e.get(t, "/api/asset/model-thumb-info?key="+urlq(key)+"&mtime=1000"))
	if d["exists"] != true {
		t.Errorf("exists = %v, want true", d["exists"])
	}
	if d["stale"] != false {
		t.Errorf("stale = %v, want false", d["stale"])
	}

	// 取图应返回 PNG
	res, err := e.srv.Client().Get(e.srv.URL + "/api/asset/model-thumb?key=" + urlq(key))
	if err != nil {
		t.Fatalf("GET model-thumb: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("status = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("content-type = %q, want image/png", ct)
	}
}

func TestModelThumbMultiFrameAPI(t *testing.T) {
	e := newEnv(t)
	key := "cm:7"
	d := data(t, e.do(t, "POST", "/api/asset/model-thumb", map[string]any{
		"key": key, "mtime": 5,
		"frames": []any{
			map[string]any{"dataUrl": pngDataURL(), "delay": 80},
			map[string]any{"dataUrl": pngDataURL(), "delay": 0},
		},
	}))
	if d["frameCount"].(float64) != 2 {
		t.Errorf("frameCount = %v, want 2", d["frameCount"])
	}
	if d["frameDelay"].(float64) != 80 {
		t.Errorf("frameDelay = %v, want 80", d["frameDelay"])
	}

	// 取帧 1
	res, err := e.srv.Client().Get(e.srv.URL + "/api/asset/model-thumb?key=" + urlq(key) + "&frame=1")
	if err != nil {
		t.Fatalf("GET frame 1: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("frame 1 status = %d, want 200", res.StatusCode)
	}
}

func TestModelThumbRejectsBadKey(t *testing.T) {
	e := newEnv(t)
	bad := []string{"", "noprefix", "im:", "packmodel:bad:x/y", "../../etc/passwd"}
	for _, k := range bad {
		raw := e.get(t, "/api/asset/model-thumb-info?key="+urlq(k))
		if okv, _ := raw["ok"].(bool); okv {
			t.Errorf("key %q 应被拒绝, got ok=true", k)
		}
		if raw["code"] != "ERR_INVALID_PARAM" {
			t.Errorf("key %q code = %v, want ERR_INVALID_PARAM", k, raw["code"])
		}
	}
}

func TestModelThumbNotFound(t *testing.T) {
	e := newEnv(t)
	// 未生成过 → ERR_FS_NOT_FOUND
	raw := e.get(t, "/api/asset/model-thumb?key="+urlq("im:999"))
	if okv, _ := raw["ok"].(bool); okv {
		t.Error("未生成的缩略图应报错")
	}
	if raw["code"] != "ERR_FS_NOT_FOUND" {
		t.Errorf("code = %v, want ERR_FS_NOT_FOUND", raw["code"])
	}
}

func TestModelThumbSaveRejectsBadDataURL(t *testing.T) {
	e := newEnv(t)
	raw := e.do(t, "POST", "/api/asset/model-thumb", map[string]any{
		"key": "im:1", "mtime": 1, "dataUrl": "not-a-data-url",
	})
	if okv, _ := raw["ok"].(bool); okv {
		t.Error("非法 dataUrl 应被拒绝")
	}
}
