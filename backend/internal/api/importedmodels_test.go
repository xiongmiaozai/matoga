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

func TestImportedModelsLocation(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/imported-models/location"))
	dir, _ := d["dir"].(string)
	if dir == "" {
		t.Fatalf("dir 为空: %v", d)
	}
	if !strings.Contains(filepath.ToSlash(dir), "data/imported-models") {
		t.Errorf("dir = %v, 应包含 data/imported-models", dir)
	}
	if d["name"] != "imported-models" {
		t.Errorf("name = %v, want imported-models", d["name"])
	}
}

func TestImportedModelsEmpty(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/imported-models"))
	models, _ := d["models"].([]any)
	if len(models) != 0 {
		t.Errorf("初始 models = %d, want 0", len(models))
	}
}

func TestImportedModelSaveLoadUpdateDelete(t *testing.T) {
	e := newEnv(t)

	bbmodel := `{"meta":{"format":"bbmodel"},"name":"我的方块","elements":[]}`
	raw := e.postJSON(t, "/api/imported-models", map[string]any{
		"name": "我的方块.bbmodel",
		"data": bbmodel,
	})
	if raw["ok"] != true {
		t.Fatalf("导入失败: %v", raw)
	}
	d, _ := raw["data"].(map[string]any)
	id, _ := d["id"].(string)
	if id == "" {
		t.Fatalf("id 为空: %v", d)
	}
	if d["ext"] != "bbmodel" {
		t.Errorf("ext = %v, want bbmodel", d["ext"])
	}

	// 文件应真实落盘为 <id>/model.bbmodel
	dir := filepath.Join(e.dir, "data", "imported-models", id)
	if _, err := os.Stat(filepath.Join(dir, "model.bbmodel")); err != nil {
		t.Fatalf("model.bbmodel 未落盘: %v", err)
	}

	// 列表
	dl := data(t, e.get(t, "/api/imported-models"))
	models, _ := dl["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("models = %d, want 1", len(models))
	}
	m, _ := models[0].(map[string]any)
	if m["id"] != id {
		t.Errorf("id = %v", m["id"])
	}
	if m["ext"] != "bbmodel" {
		t.Errorf("ext = %v", m["ext"])
	}
	if m["name"] != "我的方块" {
		t.Errorf("name = %v, want 我的方块", m["name"])
	}
	if m["format"] != "bbmodel" {
		t.Errorf("format = %v", m["format"])
	}

	// 读取
	loaded := data(t, e.get(t, "/api/imported-models/"+id))
	if loaded["raw"] != bbmodel {
		t.Errorf("raw 不匹配")
	}
	j, _ := loaded["json"].(map[string]any)
	if j["name"] != "我的方块" {
		t.Errorf("json.name = %v", j["name"])
	}

	// 覆盖更新
	updated := `{"meta":{"format":"bbmodel"},"name":"改过的","elements":[{"x":1}]}`
	raw = e.do(t, "PUT", "/api/imported-models/"+id, map[string]any{"data": updated})
	if raw["ok"] != true {
		t.Fatalf("更新失败: %v", raw)
	}
	loaded = data(t, e.get(t, "/api/imported-models/"+id))
	if loaded["raw"] != updated {
		t.Errorf("更新后 raw 不匹配")
	}

	// 删除
	if raw := e.do(t, "DELETE", "/api/imported-models/"+id, nil); raw["ok"] != true {
		t.Fatalf("删除失败: %v", raw)
	}
	if _, err := os.Stat(dir); err == nil {
		t.Error("删除后目录应不存在")
	}
	dl = data(t, e.get(t, "/api/imported-models"))
	models, _ = dl["models"].([]any)
	if len(models) != 0 {
		t.Errorf("删除后 models = %d, want 0", len(models))
	}
}

func TestImportedModelExtInference(t *testing.T) {
	e := newEnv(t)

	// 显式 ext 优先
	raw := e.postJSON(t, "/api/imported-models", map[string]any{
		"name": "x", "data": `{"a":1}`, "ext": "bbmodel",
	})
	d, _ := raw["data"].(map[string]any)
	if d["ext"] != "bbmodel" {
		t.Errorf("显式 ext = %v, want bbmodel", d["ext"])
	}

	// 文件名后缀
	raw = e.postJSON(t, "/api/imported-models", map[string]any{
		"name": "y.bbmodel", "data": `{"a":2}`,
	})
	d, _ = raw["data"].(map[string]any)
	if d["ext"] != "bbmodel" {
		t.Errorf("文件名推断 ext = %v, want bbmodel", d["ext"])
	}

	// 内容 meta.format
	raw = e.postJSON(t, "/api/imported-models", map[string]any{
		"name": "z", "data": `{"meta":{"format":"bbmodel"}}`,
	})
	d, _ = raw["data"].(map[string]any)
	if d["ext"] != "bbmodel" {
		t.Errorf("内容推断 ext = %v, want bbmodel", d["ext"])
	}

	// 都推不出 → json
	raw = e.postJSON(t, "/api/imported-models", map[string]any{
		"name": "w", "data": `{"plain":true}`,
	})
	d, _ = raw["data"].(map[string]any)
	if d["ext"] != "json" {
		t.Errorf("默认 ext = %v, want json", d["ext"])
	}
}

func TestImportedModelRejectsBadInput(t *testing.T) {
	e := newEnv(t)

	// 缺 data
	raw := e.postJSON(t, "/api/imported-models", map[string]any{"name": "x"})
	if raw["ok"] == true {
		t.Error("缺 data 应报错")
	}
	if raw["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("code = %v, want ERR_INVALID_PARAM", raw["code"])
	}

	// 非法 id（含斜杠）
	raw = e.postJSON(t, "/api/imported-models", map[string]any{
		"id": "a/b", "name": "x", "data": `{"a":1}`,
	})
	if raw["ok"] == true {
		t.Error("含斜杠的 id 应报错")
	}

	// 不存在的 id 读取
	raw = e.get(t, "/api/imported-models/nope")
	if raw["ok"] == true {
		t.Error("读取不存在模型应报错")
	}
	if raw["code"] != "ERR_FS_NOT_FOUND" {
		t.Errorf("code = %v, want ERR_FS_NOT_FOUND", raw["code"])
	}

	// 不存在的 id 更新
	raw = e.do(t, "PUT", "/api/imported-models/nope", map[string]any{"data": `{"a":1}`})
	if raw["ok"] == true {
		t.Error("更新不存在模型应报错")
	}
}

func TestImportedModelMigratesLegacy(t *testing.T) {
	e := newEnv(t)
	// 造旧版扁平文件
	dir := filepath.Join(e.dir, "data", "imported-models")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(dir, "oldmodel.bbmodel")
	if err := os.WriteFile(legacy, []byte(`{"meta":{"format":"bbmodel"},"name":"老的"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	// 列表触发惰性迁移
	d := data(t, e.get(t, "/api/imported-models"))
	models, _ := d["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("迁移后 models = %d, want 1 (%v)", len(models), models)
	}
	m, _ := models[0].(map[string]any)
	if m["id"] != "oldmodel" {
		t.Errorf("id = %v, want oldmodel", m["id"])
	}
	// 旧文件应已移入子目录
	if _, err := os.Stat(legacy); err == nil {
		t.Error("旧扁平文件应已被移走")
	}
	if _, err := os.Stat(filepath.Join(dir, "oldmodel", "model.bbmodel")); err != nil {
		t.Error("应存在 oldmodel/model.bbmodel")
	}
}
