// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAssetEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/asset"))
	fav, _ := d["favorites"].([]any)
	rec, _ := d["recent"].([]any)
	if len(fav) != 0 || len(rec) != 0 {
		t.Errorf("初始应为空: fav=%v rec=%v", fav, rec)
	}
}

func TestAssetSetAndGetFavorites(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"items": []any{
		map[string]any{"key": "tex:a", "name": "贴图 A", "type": "tex", "mtime": 1.0},
		map[string]any{"key": "hdri:b", "name": "HDR B", "type": "hdri", "mtime": 2.0},
	}}
	d := data(t, e.do(t, "PUT", "/api/asset/favorites", body))
	if d["count"].(float64) != 2 {
		t.Errorf("count = %v, want 2", d["count"])
	}

	d = data(t, e.get(t, "/api/asset"))
	fav, _ := d["favorites"].([]any)
	if len(fav) != 2 {
		t.Fatalf("收藏夹 = %d 条, want 2", len(fav))
	}
	first, _ := fav[0].(map[string]any)
	if first["key"] != "tex:a" {
		t.Errorf("key = %v, want tex:a", first["key"])
	}
	if first["name"] != "贴图 A" {
		t.Errorf("name = %v", first["name"])
	}
}

func TestAssetSetRecent(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"items": []any{
		map[string]any{"key": "model:x", "name": "模型 X", "type": "model"},
	}}
	data(t, e.do(t, "PUT", "/api/asset/recent", body))
	d := data(t, e.get(t, "/api/asset"))
	rec, _ := d["recent"].([]any)
	if len(rec) != 1 {
		t.Fatalf("最近使用 = %d 条, want 1", len(rec))
	}
}

func TestAssetByType(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"items": []any{
		map[string]any{"key": "tex:a", "name": "A", "type": "tex"},
		map[string]any{"key": "hdri:b", "name": "B", "type": "hdri"},
		map[string]any{"key": "tex:c", "name": "C", "type": "tex"},
	}}
	data(t, e.do(t, "PUT", "/api/asset/favorites", body))

	d := data(t, e.get(t, "/api/asset/type/tex"))
	fav, _ := d["favorites"].([]any)
	if len(fav) != 2 {
		t.Errorf("tex 收藏 = %d 条, want 2", len(fav))
	}
	rec, _ := d["recent"].([]any)
	if len(rec) != 0 {
		t.Errorf("tex 最近 = %d 条, want 0", len(rec))
	}

	// 非法类型返回空列表而不是报错
	d = data(t, e.get(t, "/api/asset/type/bogus"))
	fav, _ = d["favorites"].([]any)
	if len(fav) != 0 {
		t.Errorf("非法类型应返回空, got %d", len(fav))
	}
}

func TestAssetRejectsBadKeys(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"items": []any{
		map[string]any{"key": "noprefix", "name": "无前缀"},          // 无冒号 → 拒绝
		map[string]any{"key": "bogus:x", "name": "非法前缀"},         // 前缀不在白名单 → 拒绝
		map[string]any{"key": "tex:ok", "name": "合法"},             // 保留
		map[string]any{"key": "tex:ok", "name": "重复"},              // 去重
		map[string]any{"key": "tex:bad", "type": "hdri", "name": "类型冲突"}, // 拒绝
		map[string]any{"name": "无 key"},                            // 拒绝
		"not an object",                                            // 拒绝
	}}
	d := data(t, e.do(t, "PUT", "/api/asset/favorites", body))
	if d["count"].(float64) != 1 {
		t.Errorf("清洗后 count = %v, want 1", d["count"])
	}
}

func TestAssetFavoritesLimit(t *testing.T) {
	e := newEnv(t)
	items := make([]any, 0, 600)
	for i := 0; i < 600; i++ {
		items = append(items, map[string]any{
			"key": "tex:" + string(rune('a'+i%26)) + "-" + itoa(i),
		})
	}
	d := data(t, e.do(t, "PUT", "/api/asset/favorites", map[string]any{"items": items}))
	if d["count"].(float64) != 500 {
		t.Errorf("上限应为 500, got %v", d["count"])
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func TestAssetPersistedToDisk(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"items": []any{
		map[string]any{"key": "tex:a", "name": "A"},
	}}
	data(t, e.do(t, "PUT", "/api/asset/favorites", body))

	// favorites.json 应真实落盘
	p := filepath.Join(e.dir, "data", "asset-library", "favorites.json")
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("favorites.json 未落盘: %v", err)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 {
		t.Error("favorites.json 为空")
	}
}

func TestAssetInfo(t *testing.T) {
	e := newEnv(t)
	// 存在的文件
	p := filepath.Join(e.dir, "probe.txt")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	d := data(t, e.get(t, "/api/asset/info?path="+urlq(p)))
	if d["exists"] != true {
		t.Errorf("exists = %v, want true", d["exists"])
	}
	if d["isDirectory"] != false {
		t.Errorf("isDirectory = %v, want false", d["isDirectory"])
	}
	if d["size"].(float64) != 5 {
		t.Errorf("size = %v, want 5", d["size"])
	}

	// 不存在的文件返回 exists=false 而不是报错
	d = data(t, e.get(t, "/api/asset/info?path="+urlq(filepath.Join(e.dir, "nope.txt"))))
	if d["exists"] != false {
		t.Errorf("exists = %v, want false", d["exists"])
	}
	if d["size"].(float64) != 0 {
		t.Errorf("size = %v, want 0", d["size"])
	}
}

// urlq 对查询参数做百分号转义（Windows 路径含反斜杠与冒号）。
func urlq(s string) string {
	const hex = "0123456789ABCDEF"
	var b []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' || c == '/' {
			b = append(b, c)
			continue
		}
		b = append(b, '%', hex[c>>4], hex[c&0x0f])
	}
	return string(b)
}
