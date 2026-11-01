// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package fsx

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// hashCache 缓存「路径|mtime|size → md5」，避免重复读取大贴图。
var hashCache = struct {
	mu   sync.Mutex
	m    map[string]string
	max  int
	keys []string
}{m: make(map[string]string), max: 2000}

func hashKey(p string, info os.FileInfo) string {
	return fmt.Sprintf("%s|%d|%d", p, info.ModTime().UnixMilli(), info.Size())
}

// HashFile 计算文件 MD5；文件不存在返回空串。
func HashFile(p string) string {
	info, err := os.Stat(p)
	if err != nil {
		return ""
	}
	key := hashKey(p, info)

	hashCache.mu.Lock()
	if v, ok := hashCache.m[key]; ok {
		hashCache.mu.Unlock()
		return v
	}
	hashCache.mu.Unlock()

	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	sum := hex.EncodeToString(h.Sum(nil))

	hashCache.mu.Lock()
	if len(hashCache.keys) >= hashCache.max {
		evict := hashCache.keys[0]
		hashCache.keys = hashCache.keys[1:]
		delete(hashCache.m, evict)
	}
	hashCache.m[key] = sum
	hashCache.keys = append(hashCache.keys, key)
	hashCache.mu.Unlock()
	return sum
}

// InvalidateHash 丢弃某路径的哈希缓存；p 为空则清空全部。
func InvalidateHash(p string) {
	hashCache.mu.Lock()
	defer hashCache.mu.Unlock()
	if p == "" {
		hashCache.m = make(map[string]string)
		hashCache.keys = nil
		return
	}
	prefix := p + "|"
	kept := hashCache.keys[:0]
	for _, k := range hashCache.keys {
		if strings.HasPrefix(k, prefix) {
			delete(hashCache.m, k)
			continue
		}
		kept = append(kept, k)
	}
	hashCache.keys = kept
}

// HashCacheStats 返回缓存规模。
func HashCacheStats() map[string]int {
	hashCache.mu.Lock()
	defer hashCache.mu.Unlock()
	return map[string]int{"size": len(hashCache.m), "max": hashCache.max}
}

// CopyFile 复制文件，自动创建目标目录。
func CopyFile(src, dest string) OpResult {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return OpResult{Success: false, Error: err.Error()}
	}
	in, err := os.Open(src)
	if err != nil {
		return OpResult{Success: false, Error: err.Error()}
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return OpResult{Success: false, Error: err.Error()}
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return OpResult{Success: false, Error: err.Error()}
	}
	if err := out.Close(); err != nil {
		return OpResult{Success: false, Error: err.Error()}
	}
	return OpResult{Success: true}
}

// BackupResult 是备份结果。
type BackupResult struct {
	Success    bool   `json:"success"`
	BackupPath string `json:"backupPath,omitempty"`
	Error      string `json:"error,omitempty"`
}

// BackupFile 在源文件旁生成 `<name>_backup_<ts><ext>`。
func BackupFile(p string) BackupResult {
	dir := filepath.Dir(p)
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(filepath.Base(p), ext)
	ts := time.Now().Format("2006-01-02T15-04-05")
	backup := filepath.Join(dir, fmt.Sprintf("%s_backup_%s%s", base, ts, ext))
	if r := CopyFile(p, backup); !r.Success {
		return BackupResult{Success: false, Error: r.Error}
	}
	return BackupResult{Success: true, BackupPath: backup}
}

// DeleteFile 删除文件。
func DeleteFile(p string) OpResult {
	if err := os.Remove(p); err != nil {
		return OpResult{Success: false, Error: err.Error()}
	}
	return OpResult{Success: true}
}

// WriteFileBytes 原子写文件（先写临时文件再改名）。
func WriteFileBytes(p string, data []byte) error {
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(p)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, p); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

// toGray 把 RGBA 降采样成灰度图（与 Node 版 _downsampleToGray 逐位一致）。
func toGray(rgba []byte, width, height, dstW, dstH int) []byte {
	gray := make([]byte, dstW*dstH)
	for y := 0; y < dstH; y++ {
		for x := 0; x < dstW; x++ {
			sx := (float64(x) + 0.5) / float64(dstW) * float64(width)
			sy := (float64(y) + 0.5) / float64(dstH) * float64(height)
			ix := minInt(int(sx), width-1)
			iy := minInt(int(sy), height-1)
			j := (iy*width + ix) * 4
			if j+3 >= len(rgba) {
				continue
			}
			v := float64(rgba[j])*0.299 + float64(rgba[j+1])*0.587 + float64(rgba[j+2])*0.114 + 0.5
			gray[y*dstW+x] = byte(v)
		}
	}
	return gray
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func bitsToHex(bits []byte) string {
	var sb strings.Builder
	for i := 0; i < len(bits); i += 4 {
		v := 0
		for j := 0; j < 4 && i+j < len(bits); j++ {
			v = v<<1 | int(bits[i+j])
		}
		sb.WriteString(fmt.Sprintf("%x", v))
	}
	return sb.String()
}

// ComputeAHash 计算 8×8 均值哈希。
func ComputeAHash(rgba []byte, width, height int) string {
	gray := toGray(rgba, width, height, 8, 8)
	sum := 0
	for _, g := range gray {
		sum += int(g)
	}
	avg := float64(sum) / float64(len(gray))
	bits := make([]byte, len(gray))
	for i, g := range gray {
		if float64(g) > avg {
			bits[i] = 1
		}
	}
	return bitsToHex(bits)
}

// ComputeDHash 计算 9×8 差分哈希。
func ComputeDHash(rgba []byte, width, height int) string {
	const dw, dh = 9, 8
	gray := toGray(rgba, width, height, dw, dh)
	bits := make([]byte, 0, (dw-1)*dh)
	for y := 0; y < dh; y++ {
		for x := 0; x < dw-1; x++ {
			if gray[y*dw+x+1] > gray[y*dw+x] {
				bits = append(bits, 1)
			} else {
				bits = append(bits, 0)
			}
		}
	}
	return bitsToHex(bits)
}

// HammingDistance 计算两个十六进制哈希的汉明距离；长度不等返回 -1。
func HammingDistance(h1, h2 string) int {
	if h1 == "" || h2 == "" || len(h1) != len(h2) {
		return -1
	}
	dist := 0
	for i := 0; i < len(h1); i++ {
		a, ok1 := hexVal(h1[i])
		b, ok2 := hexVal(h2[i])
		if !ok1 || !ok2 {
			return -1
		}
		x := a ^ b
		for x != 0 {
			dist += x & 1
			x >>= 1
		}
	}
	return dist
}

func hexVal(c byte) (int, bool) {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0'), true
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10, true
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10, true
	}
	return 0, false
}
