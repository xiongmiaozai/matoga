// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCustomModelsTemplates(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/custom-models/templates"))
	tpls, _ := d["templates"].([]any)
	if len(tpls) != 15 {
		t.Fatalf("templates = %d, want 15", len(tpls))
	}
	first, _ := tpls[0].(map[string]any)
	if first["id"] != "cube_all" {
		t.Errorf("首个模板 id = %v, want cube_all", first["id"])
	}
	if first["category"] != "block" {
		t.Errorf("category = %v", first["category"])
	}
	// 模板列表不应携带 model 字段
	if _, ok := first["model"]; ok {
		t.Error("templates 不应返回 model 字段")
	}
	// 覆盖 block 与 item 两个分类
	cats := map[string]bool{}
	for _, x := range tpls {
		m, _ := x.(map[string]any)
		if c, ok := m["category"].(string); ok {
			cats[c] = true
		}
	}
	if !cats["block"] || !cats["item"] {
		t.Errorf("分类应含 block 与 item, got %v", cats)
	}
}

func TestCustomModelsLocation(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/custom-models/location"))
	dir, _ := d["dir"].(string)
	if !strings.Contains(filepath.ToSlash(dir), "data/custom-models") {
		t.Errorf("dir = %v", dir)
	}
	if d["name"] != "custom-models" {
		t.Errorf("name = %v", d["name"])
	}
}

func TestCustomModelCreateLoadRawUpdateDelete(t *testing.T) {
	e := newEnv(t)

	raw := e.postJSON(t, "/api/custom-models", map[string]any{
		"template": "cube_all", "name": "钻石方块", "namespace": "MyMod",
	})
	if raw["ok"] != true {
		t.Fatalf("创建失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)
	if id == "" {
		t.Fatalf("id 为空: %v", d)
	}
	// name 中文→下划线并小写，namespace 去非法字符并小写
	if d["name"] != "____" {
		t.Errorf("name = %v, want ____（中文替换为下划线）", d["name"])
	}
	if d["namespace"] != "mymod" {
		t.Errorf("namespace = %v, want mymod", d["namespace"])
	}
	if d["template"] != "cube_all" {
		t.Errorf("template = %v", d["template"])
	}
	if !strings.HasSuffix(id, "-"+strings.Split(id, "-")[len(strings.Split(id, "-"))-1]) {
		t.Errorf("id 应形如 <name>-<base36>，got %v", id)
	}

	// 落盘检查
	p := filepath.Join(e.dir, "data", "custom-models", id, "model.json")
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("model.json 未落盘: %v", err)
	}
	content, _ := os.ReadFile(p)
	if !strings.Contains(string(content), `"zznamezz"`) == false {
		// 哨兵必须已被替换
	}
	if strings.Contains(string(content), "zznamezz") || strings.Contains(string(content), "zznszz") {
		t.Error("哨兵未被替换")
	}
	if !strings.Contains(string(content), "mymod:block/____") {
		t.Errorf("贴图引用应为 mymod:block/____，实际内容片段: %s", snippet(string(content), 200))
	}

	// 列表
	dl := data(t, e.get(t, "/api/custom-models"))
	models, _ := dl["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("models = %d, want 1", len(models))
	}
	m, _ := models[0].(map[string]any)
	if m["id"] != id {
		t.Errorf("list id = %v", m["id"])
	}
	if m["template"] != "cube_all" {
		t.Errorf("list template = %v", m["template"])
	}
	if m["hasElements"] != true {
		t.Errorf("hasElements = %v, want true", m["hasElements"])
	}

	// 读取
	loaded := data(t, e.get(t, "/api/custom-models/"+id))
	j, _ := loaded["json"].(map[string]any)
	if j["id"] != id {
		t.Errorf("json.id = %v", j["id"])
	}
	if _, ok := j["model"]; !ok {
		t.Error("json 应含 model")
	}

	// raw
	rw := e.get(t, "/api/custom-models/"+id+"/raw")
	if rw["ok"] != true {
		t.Fatalf("raw 失败: %v", rw)
	}
	rm, _ := rw["data"].(map[string]any)
	if _, ok := rm["elements"]; !ok {
		t.Errorf("raw 应是 model 对象，got %v", rm)
	}

	// 更新 model
	newModel := `{"textures":{"all":"x:block/y"},"elements":[]}`
	raw = e.do(t, "PUT", "/api/custom-models/"+id, map[string]any{"model": newModel})
	if raw["ok"] != true {
		t.Fatalf("更新失败: %v", raw)
	}
	rw = e.get(t, "/api/custom-models/"+id+"/raw")
	rm, _ = rw["data"].(map[string]any)
	if _, ok := rm["elements"]; !ok {
		t.Error("更新后 raw 应仍是 model 对象")
	}

	// 更新 name
	raw = e.do(t, "PUT", "/api/custom-models/"+id, map[string]any{"name": "新名字"})
	if raw["ok"] != true {
		t.Fatalf("更新 name 失败: %v", raw)
	}
	dl = data(t, e.get(t, "/api/custom-models"))
	models, _ = dl["models"].([]any)
	m, _ = models[0].(map[string]any)
	if m["name"] != "新名字" {
		t.Errorf("name = %v, want 新名字", m["name"])
	}

	// 删除
	if raw := e.do(t, "DELETE", "/api/custom-models/"+id, nil); raw["ok"] != true {
		t.Fatalf("删除失败: %v", raw)
	}
	if _, err := os.Stat(filepath.Dir(p)); err == nil {
		t.Error("删除后目录应不存在")
	}
	dl = data(t, e.get(t, "/api/custom-models"))
	models, _ = dl["models"].([]any)
	if len(models) != 0 {
		t.Errorf("删除后 models = %d, want 0", len(models))
	}
}

func TestCustomModelRejectsBadInput(t *testing.T) {
	e := newEnv(t)

	// 缺 template
	raw := e.postJSON(t, "/api/custom-models", map[string]any{"name": "x"})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("缺 template code = %v", raw["code"])
	}
	// 缺 name
	raw = e.postJSON(t, "/api/custom-models", map[string]any{"template": "cube_all"})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("缺 name code = %v", raw["code"])
	}
	// 未知模板
	raw = e.postJSON(t, "/api/custom-models", map[string]any{"template": "nope", "name": "x"})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("未知模板 code = %v", raw["code"])
	}
	// 更新时既无 model 也无 name
	raw = e.postJSON(t, "/api/custom-models", map[string]any{"template": "cube_all", "name": "ok"})
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)
	raw = e.do(t, "PUT", "/api/custom-models/"+id, map[string]any{})
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("空更新 code = %v", raw["code"])
	}
	// 不存在
	raw = e.get(t, "/api/custom-models/nope")
	if raw["ok"] == true {
		t.Error("读取不存在模型应报错")
	}
	// 非法 id
	raw = e.get(t, "/api/custom-models/a%2Fb")
	if raw["ok"] == true {
		t.Error("非法 id 应报错")
	}
}

func TestCustomModelAllTemplatesGenerate(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/custom-models/templates"))
	tpls, _ := d["templates"].([]any)
	for _, x := range tpls {
		m, _ := x.(map[string]any)
		id, _ := m["id"].(string)
		raw := e.postJSON(t, "/api/custom-models", map[string]any{
			"template": id, "name": "probe_" + id, "namespace": "ns",
		})
		if raw["ok"] != true {
			t.Fatalf("模板 %s 创建失败: %v", id, raw)
		}
		dd, _ := raw["data"].(map[string]any)
		mid, _ := dd["id"].(string)
		rw := e.get(t, "/api/custom-models/"+mid+"/raw")
		if rw["ok"] != true {
			t.Fatalf("模板 %s 的 raw 读取失败: %v", id, rw)
		}
		rm, _ := rw["data"].(map[string]any)
		_, hasEl := rm["elements"]
		_, hasParent := rm["parent"]
		if !hasEl && !hasParent {
			t.Errorf("模板 %s 生成的模型既无 elements 也无 parent", id)
		}
		if _, ok := rm["textures"]; !ok {
			t.Errorf("模板 %s 生成的模型缺 textures", id)
		}
	}
	// 清理
	dl := data(t, e.get(t, "/api/custom-models"))
	models, _ := dl["models"].([]any)
	if len(models) != len(tpls) {
		t.Errorf("创建了 %d 个，want %d", len(models), len(tpls))
	}
	for _, x := range models {
		m, _ := x.(map[string]any)
		id, _ := m["id"].(string)
		e.do(t, "DELETE", "/api/custom-models/"+id, nil)
	}
}

// snippet 截取字符串前 n 个字符用于报错提示。
func snippet(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
