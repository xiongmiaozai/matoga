// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
)

// WorkspaceHandler 处理 /api/workspace 下的请求。
type WorkspaceHandler struct {
	Store *store.WorkspaceStore
}

// Get 返回全部预设与激活项。
func (h *WorkspaceHandler) Get(w http.ResponseWriter, r *http.Request) error {
	httpx.OK(w, h.Store.Get())
	return nil
}

// SavePreset 保存预设，body {name, config}。
func (h *WorkspaceHandler) SavePreset(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Name   string `json:"name"`
		Config any    `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	if body.Name == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "name required")
	}
	if err := h.Store.SavePreset(body.Name, body.Config); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// DeletePreset 删除预设，query name。
func (h *WorkspaceHandler) DeletePreset(w http.ResponseWriter, r *http.Request) error {
	name := r.URL.Query().Get("name")
	if name == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "name required")
	}
	if err := h.Store.DeletePreset(name); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// RenamePreset 重命名预设，body {oldName, newName}。
func (h *WorkspaceHandler) RenamePreset(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		OldName string `json:"oldName"`
		NewName string `json:"newName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	if body.OldName == "" || body.NewName == "" {
		return httpx.Errorf(httpx.CodeInvalidParam, "oldName and newName required")
	}
	if err := h.Store.RenamePreset(body.OldName, body.NewName); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// SetActive 设置激活预设，body {name}；name 为空表示清空。
func (h *WorkspaceHandler) SetActive(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	if err := h.Store.SetActive(body.Name); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{})
	return nil
}

// NodeProjectHandler 处理 /api/node-projects 下的请求。
type NodeProjectHandler struct {
	Store *store.NodeProjectStore
}

// List 返回全部工程。
func (h *NodeProjectHandler) List(w http.ResponseWriter, r *http.Request) error {
	projects, err := h.Store.List()
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"projects": projects, "dir": h.Store.Dir()})
	return nil
}

// Save 保存工程，body {id?, name, graph, thumbnail?, textures?}。
func (h *NodeProjectHandler) Save(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		ID        string         `json:"id"`
		Name      string         `json:"name"`
		Graph     map[string]any `json:"graph"`
		Thumbnail string         `json:"thumbnail"`
		Textures  []struct {
			Name string `json:"name"`
			Data string `json:"dataUrl"`
			Path string `json:"path"`
		} `json:"textures"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	in := store.NodeProjectSaveInput{
		ID: body.ID, Name: body.Name, Graph: body.Graph, Thumbnail: body.Thumbnail,
	}
	for _, t := range body.Textures {
		in.Textures = append(in.Textures, store.NodeProjectSaveTexture{
			Name: t.Name, Data: t.Data, Path: t.Path,
		})
	}
	id, err := h.Store.Save(in)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"id": id, "dir": h.Store.ProjectDir(id)})
	return nil
}

// Load 读取工程。
func (h *NodeProjectHandler) Load(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	p, err := h.Store.Load(id)
	if err != nil {
		return err
	}
	httpx.OK(w, p)
	return nil
}

// Remove 删除工程。
func (h *NodeProjectHandler) Remove(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	if err := h.Store.Remove(id); err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"id": id})
	return nil
}

// Rename 重命名工程，body {name}。
func (h *NodeProjectHandler) Rename(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(httpx.CodeInvalidParam, "invalid body")
	}
	name, err := h.Store.Rename(id, body.Name)
	if err != nil {
		return err
	}
	httpx.OK(w, map[string]any{"id": id, "name": name})
	return nil
}

// Thumb 返回工程缩略图。
func (h *NodeProjectHandler) Thumb(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	p := h.Store.ThumbPath(id)
	if _, err := os.Stat(p); err != nil {
		return httpx.Errorf(httpx.CodeFSNotFound, "thumbnail not found")
	}
	http.ServeFile(w, r, p)
	return nil
}
