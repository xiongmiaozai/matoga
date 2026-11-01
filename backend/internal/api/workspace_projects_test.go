// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ── workspace ──

func TestWorkspaceEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/workspace"))
	presets, _ := d["presets"].(map[string]any)
	if len(presets) != 0 {
		t.Errorf("初始 presets = %d, want 0", len(presets))
	}
	if d["active"] != nil {
		t.Errorf("初始 active = %v, want null", d["active"])
	}
}

func TestWorkspaceSaveAndGet(t *testing.T) {
	e := newEnv(t)

	// 保存两个预设
	if raw := e.do(t, "PUT", "/api/workspace/preset", map[string]any{
		"name":   "高对比",
		"config": map[string]any{"exposure": 1.2},
	}); raw["ok"] != true {
		t.Fatalf("保存失败: %v", raw)
	}
	if raw := e.do(t, "PUT", "/api/workspace/preset", map[string]any{
		"name":   "夜景",
		"config": map[string]any{"exposure": -0.5},
	}); raw["ok"] != true {
		t.Fatalf("保存失败: %v", raw)
	}

	d := data(t, e.get(t, "/api/workspace"))
	presets, _ := d["presets"].(map[string]any)
	if len(presets) != 2 {
		t.Fatalf("presets = %d, want 2 (%v)", len(presets), presets)
	}
	p, _ := presets["高对比"].(map[string]any)
	if p == nil {
		t.Fatalf("缺少「高对比」预设: %v", presets)
	}
	cfg, _ := p["config"].(map[string]any)
	if cfg["exposure"] != 1.2 {
		t.Errorf("config.exposure = %v, want 1.2", cfg["exposure"])
	}
	if p["updatedAt"] == nil {
		t.Error("updatedAt 不应为 null")
	}

	// 落盘确认
	idxFile := filepath.Join(e.dir, "data", "workspaces", "index.json")
	if _, err := os.Stat(idxFile); err != nil {
		t.Fatalf("index.json 未落盘: %v", err)
	}
}

func TestWorkspaceSetActiveAndDelete(t *testing.T) {
	e := newEnv(t)
	e.do(t, "PUT", "/api/workspace/preset", map[string]any{"name": "A", "config": map[string]any{"v": 1}})
	e.do(t, "PUT", "/api/workspace/preset", map[string]any{"name": "B", "config": map[string]any{"v": 2}})

	// 设为激活
	if raw := e.do(t, "PUT", "/api/workspace/active", map[string]any{"name": "A"}); raw["ok"] != true {
		t.Fatalf("setActive 失败: %v", raw)
	}
	d := data(t, e.get(t, "/api/workspace"))
	if d["active"] != "A" {
		t.Errorf("active = %v, want A", d["active"])
	}

	// 删除激活项应同时清空 active
	if raw := e.do(t, "DELETE", "/api/workspace/preset?name=A", nil); raw["ok"] != true {
		t.Fatalf("删除失败: %v", raw)
	}
	d = data(t, e.get(t, "/api/workspace"))
	presets, _ := d["presets"].(map[string]any)
	if len(presets) != 1 {
		t.Errorf("删除后 presets = %d, want 1", len(presets))
	}
	if d["active"] != nil {
		t.Errorf("删除激活项后 active = %v, want null", d["active"])
	}
}

func TestWorkspaceRename(t *testing.T) {
	e := newEnv(t)
	e.do(t, "PUT", "/api/workspace/preset", map[string]any{
		"name": "旧名", "config": map[string]any{"v": 42},
	})
	if raw := e.do(t, "PUT", "/api/workspace/rename", map[string]any{
		"oldName": "旧名", "newName": "新名",
	}); raw["ok"] != true {
		t.Fatalf("重命名失败: %v", raw)
	}
	d := data(t, e.get(t, "/api/workspace"))
	presets, _ := d["presets"].(map[string]any)
	if _, ok := presets["旧名"]; ok {
		t.Error("旧名应已不存在")
	}
	p, ok := presets["新名"].(map[string]any)
	if !ok {
		t.Fatalf("新名不存在: %v", presets)
	}
	cfg, _ := p["config"].(map[string]any)
	if cfg["v"] != 42.0 {
		t.Errorf("重命名后 config.v = %v, want 42", cfg["v"])
	}
}

func TestWorkspaceRejectsEmptyName(t *testing.T) {
	e := newEnv(t)
	raw := e.do(t, "PUT", "/api/workspace/preset", map[string]any{"config": map[string]any{}})
	if raw["ok"] == true {
		t.Error("空 name 应报错")
	}
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("code = %v, want ERR_INVALID_PARAM", raw["code"])
	}
}

func TestWorkspaceMigratesLegacy(t *testing.T) {
	e := newEnv(t)
	// 造旧版单文件
	dataDir := filepath.Join(e.dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := map[string]any{
		"presets": map[string]any{
			"老预设": map[string]any{"config": map[string]any{"v": 7}, "updatedAt": 1000},
		},
		"active": "老预设",
	}
	buf, _ := json.Marshal(legacy)
	if err := os.WriteFile(filepath.Join(dataDir, "workspaces.json"), buf, 0o644); err != nil {
		t.Fatal(err)
	}

	d := data(t, e.get(t, "/api/workspace"))
	presets, _ := d["presets"].(map[string]any)
	if len(presets) != 1 {
		t.Fatalf("迁移后 presets = %d, want 1 (%v)", len(presets), presets)
	}
	if d["active"] != "老预设" {
		t.Errorf("active = %v, want 老预设", d["active"])
	}
	// 旧文件应被改名
	if _, err := os.Stat(filepath.Join(dataDir, "workspaces.json")); err == nil {
		t.Error("旧 workspaces.json 应已改名")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "workspaces.json.bak")); err != nil {
		t.Error("应存在 workspaces.json.bak")
	}
}

// ── node-projects ──

func TestNodeProjectsEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/node-projects"))
	projects, _ := d["projects"].([]any)
	if len(projects) != 0 {
		t.Errorf("初始 projects = %d, want 0", len(projects))
	}
	if d["dir"] == nil || d["dir"] == "" {
		t.Error("dir 不应为空")
	}
}

func TestNodeProjectSaveLoadRemove(t *testing.T) {
	e := newEnv(t)

	graph := map[string]any{
		"nodes": []any{
			map[string]any{"id": 1, "type": "noise"},
			map[string]any{"id": 2, "type": "output"},
		},
		"links": []any{map[string]any{"from": 1, "to": 2}},
	}
	// 1x1 PNG 的 dataURL
	tiny := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

	raw := e.postJSON(t, "/api/node-projects", map[string]any{
		"name":  "我的工程",
		"graph": graph,
		"textures": []any{
			map[string]any{"name": "砖块.png", "dataUrl": tiny},
		},
		"thumbnail": tiny,
	})
	if raw["ok"] != true {
		t.Fatalf("保存失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)
	if id == "" {
		t.Fatalf("id 为空: %v", d)
	}

	// 列表
	dl := data(t, e.get(t, "/api/node-projects"))
	projects, _ := dl["projects"].([]any)
	if len(projects) != 1 {
		t.Fatalf("projects = %d, want 1", len(projects))
	}
	m, _ := projects[0].(map[string]any)
	if m["name"] != "我的工程" {
		t.Errorf("name = %v", m["name"])
	}
	if m["nodeCount"] != 2.0 {
		t.Errorf("nodeCount = %v, want 2", m["nodeCount"])
	}
	if m["edgeCount"] != 1.0 {
		t.Errorf("edgeCount = %v, want 1", m["edgeCount"])
	}
	if m["textureCount"] != 1.0 {
		t.Errorf("textureCount = %v, want 1", m["textureCount"])
	}
	if m["hasThumb"] != true {
		t.Error("hasThumb 应为 true")
	}

	// 读取
	loaded := data(t, e.get(t, "/api/node-projects/"+id))
	if loaded["name"] != "我的工程" {
		t.Errorf("load name = %v", loaded["name"])
	}
	textures, _ := loaded["textures"].([]any)
	if len(textures) != 1 {
		t.Fatalf("load textures = %d, want 1", len(textures))
	}
	tex, _ := textures[0].(map[string]any)
	if tex["exists"] != true {
		t.Error("贴图应存在")
	}
	if !strings.HasPrefix(tex["name"].(string), "砖块") {
		t.Errorf("贴图名 = %v", tex["name"])
	}

	// 缩略图可访问
	res, err := e.srv.Client().Get(e.srv.URL + "/api/node-projects/" + id + "/thumb")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("thumb status = %d, want 200", res.StatusCode)
	}

	// 重命名
	if raw := e.do(t, "PUT", "/api/node-projects/"+id+"/rename", map[string]any{"name": "改名了"}); raw["ok"] != true {
		t.Fatalf("重命名失败: %v", raw)
	}
	loaded = data(t, e.get(t, "/api/node-projects/"+id))
	if loaded["name"] != "改名了" {
		t.Errorf("重命名后 name = %v", loaded["name"])
	}

	// 删除
	if raw := e.do(t, "DELETE", "/api/node-projects/"+id, nil); raw["ok"] != true {
		t.Fatalf("删除失败: %v", raw)
	}
	dl = data(t, e.get(t, "/api/node-projects"))
	projects, _ = dl["projects"].([]any)
	if len(projects) != 0 {
		t.Errorf("删除后 projects = %d, want 0", len(projects))
	}
}

func TestNodeProjectUpdate(t *testing.T) {
	e := newEnv(t)
	graph := map[string]any{"nodes": []any{map[string]any{"id": 1}}, "links": []any{}}
	raw := e.postJSON(t, "/api/node-projects", map[string]any{"name": "工程", "graph": graph})
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)

	// 更新：加一个节点
	graph2 := map[string]any{
		"nodes": []any{map[string]any{"id": 1}, map[string]any{"id": 2}},
		"links": []any{map[string]any{"from": 1, "to": 2}},
	}
	raw2 := e.postJSON(t, "/api/node-projects", map[string]any{
		"id": id, "name": "工程", "graph": graph2,
	})
	if raw2["ok"] != true {
		t.Fatalf("更新失败: %v", raw2)
	}
	d2, _ := raw2["data"].(map[string]any)
	if d2["id"] != id {
		t.Errorf("更新后 id 变了: %v → %v", id, d2["id"])
	}
	loaded := data(t, e.get(t, "/api/node-projects/"+id))
	if loaded["name"] != "工程" {
		t.Errorf("name = %v", loaded["name"])
	}
	g, _ := loaded["graph"].(map[string]any)
	nodes, _ := g["nodes"].([]any)
	if len(nodes) != 2 {
		t.Errorf("nodes = %d, want 2", len(nodes))
	}
}

func TestNodeProjectRejectsBadInput(t *testing.T) {
	e := newEnv(t)

	// 空名字
	raw := e.postJSON(t, "/api/node-projects", map[string]any{
		"name": "", "graph": map[string]any{"nodes": []any{}},
	})
	if raw["ok"] == true {
		t.Error("空 name 应报错")
	}

	// 无 graph
	raw = e.postJSON(t, "/api/node-projects", map[string]any{"name": "x"})
	if raw["ok"] == true {
		t.Error("缺 graph 应报错")
	}

	// graph.nodes 不是数组
	raw = e.postJSON(t, "/api/node-projects", map[string]any{
		"name": "x", "graph": map[string]any{"nodes": "nope"},
	})
	if raw["ok"] == true {
		t.Error("非法 graph 应报错")
	}

	// 不存在的 id 更新
	raw = e.postJSON(t, "/api/node-projects", map[string]any{
		"id": "nonexistent", "name": "x", "graph": map[string]any{"nodes": []any{}},
	})
	if raw["ok"] == true {
		t.Error("不存在的 id 应报错")
	}
	if raw["code"] != "ERR_NOT_FOUND" {
		t.Errorf("code = %v, want ERR_NOT_FOUND", raw["code"])
	}

	// 不存在的工程读取
	raw = e.get(t, "/api/node-projects/nonexistent")
	if raw["ok"] == true {
		t.Error("读取不存在工程应报错")
	}
}

func TestNodeProjectThumbMissing(t *testing.T) {
	e := newEnv(t)
	graph := map[string]any{"nodes": []any{}, "links": []any{}}
	raw := e.postJSON(t, "/api/node-projects", map[string]any{"name": "无图", "graph": graph})
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)

	// 与 Node 版一致：错误用 HTTP 200 + body ok:false 表达
	got := e.get(t, "/api/node-projects/"+id+"/thumb")
	if got["ok"] == true {
		t.Error("无缩略图时应返回 ok:false")
	}
	if got["code"] != "ERR_FS_NOT_FOUND" {
		t.Errorf("code = %v, want ERR_FS_NOT_FOUND", got["code"])
	}
}
