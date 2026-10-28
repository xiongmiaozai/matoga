// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package api_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiongmiaozai/matoga/backend/internal/api"
	"github.com/xiongmiaozai/matoga/backend/internal/fsx"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
	"github.com/xiongmiaozai/matoga/backend/internal/media"
	"github.com/xiongmiaozai/matoga/backend/internal/platform"
	"github.com/xiongmiaozai/matoga/backend/internal/store"
	"github.com/xiongmiaozai/matoga/backend/internal/upload"
)

type testEnv struct {
	srv         *httptest.Server
	dir         string
	paths       platform.Paths
	auth        *httpx.Auth
	config      *store.Config
	thumb       *media.Thumb
	assets      *store.AssetStore
	modelThumbs *media.ModelThumb
	upload      *upload.Service
	panelsDir   string
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()
	paths := platform.Paths{ResRoot: dir, DataRoot: dir, PresetRoot: dir}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	fsx.Trust(dir)
	t.Cleanup(func() { fsx.Trust("") })

	auth := httpx.NewAuth("")
	cfg := store.NewConfig(paths, log)
	thumb := media.NewThumb(paths)
	r := httpx.NewRouter(auth, log)
	hdri := media.NewHDRI(paths, cfg)
	assets := store.NewAssetStore(dir, log)
	modelThumbs := media.NewModelThumb(dir)
	up := upload.New(dir)
	panelsDir := filepath.Join(dir, "web", "src", "panels")
	api.Mount(r, api.Services{
		Deps:        &api.Deps{Auth: auth},
		Config:      cfg,
		Thumbs:      thumb,
		HDRI:        hdri,
		Assets:      assets,
		ModelThumbs: modelThumbs,
		Upload:      up,
		PanelsDir:   panelsDir,
	})
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &testEnv{
		srv: srv, dir: dir, paths: paths, auth: auth, config: cfg,
		thumb: thumb, assets: assets, modelThumbs: modelThumbs,
		upload: up, panelsDir: panelsDir,
	}
}

func (e *testEnv) get(t *testing.T, path string) map[string]any {
	t.Helper()
	res, err := http.Get(e.srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	return decode(t, res.Body)
}

func (e *testEnv) postJSON(t *testing.T, path string, body any) map[string]any {
	t.Helper()
	buf, _ := json.Marshal(body)
	res, err := http.Post(e.srv.URL+path, "application/json", bytes.NewReader(buf))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer res.Body.Close()
	return decode(t, res.Body)
}

func (e *testEnv) do(t *testing.T, method, path string, body any) map[string]any {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rdr = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rdr)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	return decode(t, res.Body)
}

func decode(t *testing.T, r io.Reader) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(r).Decode(&m); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	return m
}

func data(t *testing.T, resp map[string]any) map[string]any {
	t.Helper()
	ok, _ := resp["ok"].(bool)
	if !ok {
		t.Fatalf("响应 ok=false: %v", resp)
	}
	d, _ := resp["data"].(map[string]any)
	return d
}

func TestHealthEndpoint(t *testing.T) {
	e := newEnv(t)
	d := data(t, e.get(t, "/api/health"))
	if d["status"] != "ok" {
		t.Errorf("status = %v", d["status"])
	}
	if d["runtime"] != "go" {
		t.Errorf("runtime = %v, want go", d["runtime"])
	}
	if d["lan"] != false {
		t.Errorf("lan = %v, want false", d["lan"])
	}
}

func TestConfigGetPutClear(t *testing.T) {
	e := newEnv(t)

	d := data(t, e.get(t, "/api/config"))
	if d["theme"] != "light" {
		t.Errorf("默认 theme = %v", d["theme"])
	}
	if d["locale"] != "zh" {
		t.Errorf("默认 locale = %v", d["locale"])
	}
	// 默认路径应被补全
	if p, _ := d["mcPacksPath"].(string); !strings.HasSuffix(p, "mc-packs") {
		t.Errorf("mcPacksPath = %v", d["mcPacksPath"])
	}

	d = data(t, e.do(t, http.MethodPut, "/api/config", map[string]any{"theme": "dark", "recursive": true}))
	if len(d) != 0 {
		t.Errorf("PUT 应返回空对象, got %v", d)
	}
	d = data(t, e.get(t, "/api/config"))
	if d["theme"] != "dark" {
		t.Errorf("PUT 后 theme = %v", d["theme"])
	}
	if d["recursive"] != true {
		t.Errorf("PUT 后 recursive = %v", d["recursive"])
	}

	data(t, e.do(t, http.MethodDelete, "/api/config", nil))
	d = data(t, e.get(t, "/api/config"))
	if d["theme"] != "light" {
		t.Errorf("clear 后 theme = %v, want light", d["theme"])
	}
}

func TestConfigPutStripsWindowBounds(t *testing.T) {
	e := newEnv(t)
	e.do(t, http.MethodPut, "/api/config", map[string]any{"windowBounds": map[string]any{"x": 1}})
	d := data(t, e.get(t, "/api/config"))
	if _, ok := d["windowBounds"]; ok {
		t.Error("windowBounds 应被剔除")
	}
}

func TestFSBrowseRootAndDir(t *testing.T) {
	e := newEnv(t)
	sub := filepath.Join(e.dir, "alpha")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(sub, "beta"), 0o755); err != nil {
		t.Fatal(err)
	}

	d := data(t, e.get(t, "/api/fs/browse?path="+urlQuery(sub)))
	dirs, _ := d["dirs"].([]any)
	if len(dirs) != 1 {
		t.Fatalf("dirs = %d, want 1 (%v)", len(dirs), d["dirs"])
	}
	first, _ := dirs[0].(map[string]any)
	if first["name"] != "beta" {
		t.Errorf("子目录名 = %v", first["name"])
	}

	// 相对路径应报 ERR_INVALID_PARAM
	resp := e.get(t, "/api/fs/browse?path=relative%2Fdir")
	if resp["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("相对路径错误码 = %v", resp["code"])
	}
}

func TestFSCreateSearch(t *testing.T) {
	e := newEnv(t)
	target := filepath.Join(e.dir, "newdir", "nested")

	d := data(t, e.postJSON(t, "/api/fs/create", map[string]any{"path": target}))
	if d["success"] != true {
		t.Fatalf("create 失败: %v", d)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("目录未创建: %v", err)
	}

	d = data(t, e.get(t, "/api/fs/search?path="+urlQuery(e.dir)+"&q=nested&depth=3&limit=10"))
	results, _ := d["results"].([]any)
	if len(results) != 1 {
		t.Fatalf("搜索结果 = %d, want 1", len(results))
	}

	// 空查询返回空结果
	d = data(t, e.get(t, "/api/fs/search?path="+urlQuery(e.dir)+"&q="))
	if results, _ := d["results"].([]any); len(results) != 0 {
		t.Errorf("空查询应返回空数组, got %d", len(results))
	}
}

func TestFileHashCopyBackupDelete(t *testing.T) {
	e := newEnv(t)
	src := filepath.Join(e.dir, "src.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	d := data(t, e.postJSON(t, "/api/file/hash", map[string]any{"path": src}))
	if d["hash"] != "5d41402abc4b2a76b9719d911017c592" {
		t.Errorf("hash = %v", d["hash"])
	}

	dest := filepath.Join(e.dir, "out", "copy.txt")
	d = data(t, e.postJSON(t, "/api/file/copy", map[string]any{"src": src, "dest": dest}))
	if d["success"] != true {
		t.Fatalf("复制失败: %v", d)
	}
	if b, err := os.ReadFile(dest); err != nil || string(b) != "hello" {
		t.Fatalf("复制内容错误: %v %q", err, b)
	}

	d = data(t, e.postJSON(t, "/api/file/backup", map[string]any{"path": src}))
	bp, _ := d["backupPath"].(string)
	if d["success"] != true || bp == "" {
		t.Fatalf("备份失败: %v", d)
	}
	if !strings.Contains(filepath.Base(bp), "_backup_") {
		t.Errorf("备份文件名不符合约定: %s", bp)
	}

	d = data(t, e.postJSON(t, "/api/file/delete", map[string]any{"path": dest}))
	if d["success"] != true {
		t.Fatalf("删除失败: %v", d)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Error("文件应已删除")
	}
}

func TestFileCopyOutsideTrustedRootDenied(t *testing.T) {
	e := newEnv(t)
	src := filepath.Join(e.dir, "a.txt")
	_ = os.WriteFile(src, []byte("x"), 0o644)
	outside := filepath.Join(os.TempDir(), "matoga-outside-test.txt")
	resp := e.postJSON(t, "/api/file/copy", map[string]any{"src": src, "dest": outside})
	if resp["code"] != "ERR_PATH_DENIED" {
		t.Errorf("可信根外写入错误码 = %v, want ERR_PATH_DENIED", resp["code"])
	}
}

func TestFileRawAndThumbFlow(t *testing.T) {
	e := newEnv(t)
	img := filepath.Join(e.dir, "tex.png")
	if err := os.WriteFile(img, []byte("not-a-real-png"), 0o644); err != nil {
		t.Fatal(err)
	}

	// raw 直接返回字节
	res, err := http.Get(e.srv.URL + "/api/file/raw?path=" + urlQuery(img))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "not-a-real-png" {
		t.Errorf("raw 内容 = %q", body)
	}

	// 缩略图尚未生成
	d := data(t, e.get(t, "/api/file/thumb-info?path="+urlQuery(img)))
	if d["exists"] != false {
		t.Errorf("thumb-info.exists = %v, want false", d["exists"])
	}
	if !strings.HasPrefix(d["thumbUrl"].(string), "/api/file/thumb?path=") {
		t.Errorf("thumbUrl = %v", d["thumbUrl"])
	}

	// 保存缩略图
	payload := base64.StdEncoding.EncodeToString([]byte("fake-jpeg"))
	d = data(t, e.postJSON(t, "/api/file/thumb", map[string]any{
		"path":    img,
		"dataUrl": "data:image/jpeg;base64," + payload,
	}))
	if d["success"] != true {
		t.Fatalf("保存缩略图失败: %v", d)
	}
	d = data(t, e.get(t, "/api/file/thumb-info?path="+urlQuery(img)))
	if d["exists"] != true {
		t.Errorf("保存后 exists = %v", d["exists"])
	}

	// 缩略图可下载
	res2, err := http.Get(e.srv.URL + "/api/file/thumb?path=" + urlQuery(img))
	if err != nil {
		t.Fatal(err)
	}
	thumbBody, _ := io.ReadAll(res2.Body)
	res2.Body.Close()
	if string(thumbBody) != "fake-jpeg" {
		t.Errorf("thumb 内容 = %q", thumbBody)
	}

	// 非法 dataUrl 被拒
	resp := e.postJSON(t, "/api/file/thumb", map[string]any{"path": img, "dataUrl": "http://x/y.png"})
	if resp["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("非法 dataUrl 错误码 = %v", resp["code"])
	}
}

func TestFileWriteEndpoint(t *testing.T) {
	e := newEnv(t)
	p := filepath.Join(e.dir, "write", "out.png")
	payload := base64.StdEncoding.EncodeToString([]byte("bytes"))
	d := data(t, e.postJSON(t, "/api/file/write", map[string]any{
		"path":    p,
		"dataUrl": "data:image/png;base64," + payload,
	}))
	if d["size"].(float64) != 5 {
		t.Errorf("写入大小 = %v", d["size"])
	}
	if b, err := os.ReadFile(p); err != nil || string(b) != "bytes" {
		t.Fatalf("写入内容错误: %v %q", err, b)
	}

	resp := e.postJSON(t, "/api/file/write", map[string]any{"path": p, "dataUrl": "data:image/png;base64,"})
	if resp["code"] != "ERR_INVALID_PARAM" {
		t.Errorf("空数据错误码 = %v", resp["code"])
	}
}

func TestLANModeRequiresToken(t *testing.T) {
	dir := t.TempDir()
	paths := platform.Paths{ResRoot: dir, DataRoot: dir, PresetRoot: dir}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	auth := httpx.NewAuth("secret-token")
	r := httpx.NewRouter(auth, log)
	cfg2 := store.NewConfig(paths, log)
	api.Mount(r, api.Services{
		Deps:   &api.Deps{Auth: auth},
		Config: cfg2,
		Thumbs: media.NewThumb(paths),
		HDRI:   media.NewHDRI(paths, cfg2),
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/config")
	if err != nil {
		t.Fatal(err)
	}
	body := decode(t, res.Body)
	res.Body.Close()
	if body["code"] != "ERR_UNAUTHORIZED" {
		t.Errorf("无令牌错误码 = %v", body["code"])
	}

	res2, err := http.Get(srv.URL + "/api/config?token=secret-token")
	if err != nil {
		t.Fatal(err)
	}
	body2 := decode(t, res2.Body)
	res2.Body.Close()
	if body2["ok"] != true {
		t.Errorf("带令牌应通过: %v", body2)
	}

	// header 方式
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/config", nil)
	req.Header.Set("x-matoga-token", "secret-token")
	res3, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body3 := decode(t, res3.Body)
	res3.Body.Close()
	if body3["ok"] != true {
		t.Errorf("header 令牌应通过: %v", body3)
	}
}

func urlQuery(s string) string {
	return strings.ReplaceAll(urlEscape(s), "%2F", "%2F")
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == ' ':
			b.WriteString("%20")
		case r == '\\':
			b.WriteString("%5C")
		case r == '/':
			b.WriteString("%2F")
		case r == ':':
			b.WriteString("%3A")
		case r > 127 || r == '&' || r == '?' || r == '#' || r == '+':
			b.WriteString(pctEncode(r))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func pctEncode(r rune) string {
	buf := []byte(string(r))
	var sb strings.Builder
	for _, c := range buf {
		const hexDigits = "0123456789ABCDEF"
		sb.WriteByte('%')
		sb.WriteByte(hexDigits[c>>4])
		sb.WriteByte(hexDigits[c&0x0F])
	}
	return sb.String()
}
