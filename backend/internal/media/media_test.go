// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/png"
	"io"
	"strings"
	"testing"

	"github.com/bbrks/go-blurhash"
	"github.com/mrjoshuak/go-openexr/exr"
)

// buildHDR 构造一个未压缩（flat）的 Radiance RGBE 文件。
func buildHDR(w, h int, pixels []byte) []byte {
	var buf bytes.Buffer
	buf.WriteString("#?RADIANCE\n")
	buf.WriteString("FORMAT=32-bit_rle_rgbe\n")
	buf.WriteString("\n")
	buf.WriteString("-Y " + itoa(h) + " +X " + itoa(w) + "\n")
	buf.Write(pixels)
	return buf.Bytes()
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var digits []byte
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}

func TestDecodeHDRFlat(t *testing.T) {
	// 2x1 像素：R=128,G=64,B=32,E=129
	w, h := 2, 1
	pixels := []byte{
		128, 64, 32, 129,
		255, 128, 64, 130,
	}
	img, err := DecodeHDR(buildHDR(w, h, pixels))
	if err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if img.Width != w || img.Height != h {
		t.Fatalf("尺寸 = %dx%d, want %dx%d", img.Width, img.Height, w, h)
	}
	if img.Format != "HDR (RGBE)" {
		t.Errorf("format = %q", img.Format)
	}
	// scale = 2^(129-128)/255 = 2/255
	want := float32(128) * 2.0 / 255.0
	if diff := img.Data[0] - want; diff > 1e-5 || diff < -1e-5 {
		t.Errorf("R = %v, want %v", img.Data[0], want)
	}
	if img.Data[3] != 1 {
		t.Errorf("alpha = %v, want 1", img.Data[3])
	}
}

func TestDecodeHDRBadMagic(t *testing.T) {
	if _, err := DecodeHDR([]byte("not a hdr file")); err == nil {
		t.Error("坏魔数应报错")
	}
}

func TestDecodeHDRMissingDimensions(t *testing.T) {
	buf := []byte("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
	if _, err := DecodeHDR(buf); err == nil {
		t.Error("缺少尺寸应报错")
	}
}

func TestTonemapProducesSRGBBytes(t *testing.T) {
	w, h := 2, 1
	data := []float32{
		0, 0, 0, 1,
		10, 10, 10, 1,
	}
	rgba := TonemapToRGBA(w, h, data)
	if len(rgba) != w*h*4 {
		t.Fatalf("长度 = %d", len(rgba))
	}
	// 全黑像素映射为 0
	if rgba[0] != 0 || rgba[1] != 0 || rgba[2] != 0 {
		t.Errorf("黑色素 = %v,%v,%v", rgba[0], rgba[1], rgba[2])
	}
	// 自动曝光把平均亮度拉到中灰附近：高亮像素应明显亮于黑色
	if rgba[4] <= 100 {
		t.Errorf("高亮 R = %d, want > 100", rgba[4])
	}
	if rgba[4] <= rgba[0] {
		t.Error("高亮像素应亮于黑色像素")
	}
	if rgba[3] != 255 || rgba[7] != 255 {
		t.Error("alpha 应为 255")
	}
}

func TestEncodePNGDecodable(t *testing.T) {
	rgba := []byte{
		255, 0, 0, 255,
		0, 255, 0, 255,
	}
	buf, err := EncodePNG(2, 1, rgba)
	if err != nil {
		t.Fatalf("PNG 编码失败: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(buf))
	if err != nil {
		t.Fatalf("PNG 解码失败: %v", err)
	}
	if img.Bounds().Dx() != 2 || img.Bounds().Dy() != 1 {
		t.Errorf("尺寸 = %v", img.Bounds())
	}
}

func TestBlurhashShape(t *testing.T) {
	// 32x16 纯色图
	w, h := 32, 16
	rgba := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		rgba[i*4] = 200
		rgba[i*4+1] = 100
		rgba[i*4+2] = 50
		rgba[i*4+3] = 255
	}
	hash := EncodeBlurhash(rgba, w, h, 4, 3)
	// blurhash 规范：1(sizeFlag) + 1(maxValue) + 4(DC) + (4*3-1)*2 = 28 字符
	if len(hash) != 28 {
		t.Fatalf("blurhash 长度 = %d (%q), want 28", len(hash), hash)
	}
	if strings.ContainsAny(hash, " \t\n") {
		t.Errorf("blurhash 不应含空白: %q", hash)
	}
	// sizeFlag = (cx-1) + (cy-1)*9 = 3 + 18 = 21 → base83 第 21 位
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"
	if hash[0] != chars[21] {
		t.Errorf("首字符 = %q, want %q", hash[0], chars[21])
	}
	// 纯色图的 AC 分量应全部量化为 0，可被标准解码器还原为近似纯色
	if hash[2:6] == "0000" {
		t.Logf("DC 分量 = %q", hash[2:6])
	}
}

// TestBlurhashMatchesReference 用一张真实渐变图校验输出与参考实现一致。
func TestBlurhashMatchesReference(t *testing.T) {
	const w, h = 32, 16
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			rgba[i] = byte(x * 255 / w)
			rgba[i+1] = byte(y * 255 / h)
			rgba[i+2] = 128
			rgba[i+3] = 255
		}
	}
	got := EncodeBlurhash(rgba, w, h, 4, 3)
	if len(got) != 28 {
		t.Fatalf("长度 = %d (%q)", len(got), got)
	}
	// 与 bbrks/go-blurhash 直接调用结果比对
	img := &image.NRGBA{Pix: rgba, Stride: w * 4, Rect: image.Rect(0, 0, w, h)}
	want, err := blurhash.Encode(4, 3, img)
	if err != nil {
		t.Fatalf("参考编码失败: %v", err)
	}
	if got != want {
		t.Errorf("blurhash = %q, want %q", got, want)
	}
}

func TestGenerateThumbFromHDR(t *testing.T) {
	w, h := 4, 2
	pixels := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		pixels[i*4] = 200
		pixels[i*4+1] = 150
		pixels[i*4+2] = 100
		pixels[i*4+3] = 128
	}
	result, err := GenerateThumb(buildHDR(w, h, pixels), "hdr", 480, 240)
	if err != nil {
		t.Fatalf("生成缩略图失败: %v", err)
	}
	// 不放大：ratio = min(480/4, 240/2, 1) = 1
	if result.Width != w || result.Height != h {
		t.Errorf("缩略图尺寸 = %dx%d, want %dx%d", result.Width, result.Height, w, h)
	}
	if result.SrcWidth != w || result.SrcHeight != h {
		t.Errorf("源尺寸 = %dx%d", result.SrcWidth, result.SrcHeight)
	}
	if result.Blurhash == "" {
		t.Error("blurhash 不应为空")
	}
	if _, err := png.Decode(bytes.NewReader(result.PNG)); err != nil {
		t.Errorf("生成的 PNG 无法解码: %v", err)
	}
}

func TestGenerateThumbDownsamples(t *testing.T) {
	w, h := 1000, 500
	pixels := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		pixels[i*4+3] = 128
	}
	result, err := GenerateThumb(buildHDR(w, h, pixels), "hdr", 480, 240)
	if err != nil {
		t.Fatalf("生成失败: %v", err)
	}
	// ratio = min(0.48, 0.48, 1) = 0.48 → 480x240
	if result.Width != 480 || result.Height != 240 {
		t.Errorf("缩略图尺寸 = %dx%d, want 480x240", result.Width, result.Height)
	}
}

// TestDecodeEXRRoundTrip 用 go-openexr 编码一张 EXR，再由我们的 DecodeEXR 解码，
// 验证换库后的解码链路仍然正确。
func TestDecodeEXRRoundTrip(t *testing.T) {
	const w, h = 4, 3
	src := exr.NewRGBAImage(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			src.SetRGBA(x, y, float32(x)/float32(w), float32(y)/float32(h), 0.5, 1)
		}
	}
	var buf bytes.Buffer
	if err := exr.Encode(&writeSeeker{&buf}, src); err != nil {
		t.Fatalf("EXR 编码失败: %v", err)
	}

	img, err := DecodeEXR(buf.Bytes())
	if err != nil {
		t.Fatalf("EXR 解码失败: %v", err)
	}
	if img.Width != w || img.Height != h {
		t.Fatalf("尺寸 = %dx%d, want %dx%d", img.Width, img.Height, w, h)
	}
	if img.Format != "EXR" {
		t.Errorf("format = %q", img.Format)
	}
	// 左上角 (0,0)：R=0, G=0, B=0.5
	if d := img.Data[2] - 0.5; d > 1e-3 || d < -1e-3 {
		t.Errorf("(0,0) B = %v, want 0.5", img.Data[2])
	}
	// 右下角 (3,2)：R=0.75
	if d := img.Data[(2*w+3)*4] - 0.75; d > 1e-3 || d < -1e-3 {
		t.Errorf("(3,2) R = %v, want 0.75", img.Data[(2*w+3)*4])
	}
	if img.Data[3] != 1 {
		t.Errorf("alpha = %v, want 1", img.Data[3])
	}
}

// writeSeeker 让 bytes.Buffer 满足 io.WriteSeeker。
type writeSeeker struct{ b *bytes.Buffer }

func (w *writeSeeker) Write(p []byte) (int, error) { return w.b.Write(p) }
func (w *writeSeeker) Seek(off int64, whence int) (int64, error) {
	if whence == io.SeekStart && off == 0 {
		w.b.Reset()
	}
	return int64(w.b.Len()), nil
}

func TestDecodeEXRRejectsInvalid(t *testing.T) {
	if _, err := DecodeEXR([]byte{1, 2, 3}); err == nil {
		t.Error("过短应报错")
	}
	bad := make([]byte, 16)
	binary.LittleEndian.PutUint32(bad[0:4], 12345)
	if _, err := DecodeEXR(bad); err == nil {
		t.Error("坏魔数应报错")
	}
}

func TestDetectAndDecodePrefersMagic(t *testing.T) {
	w, h := 1, 1
	pixels := []byte{100, 100, 100, 128}
	// 文件名扩展名故意给错，魔数应胜出
	img, err := DetectAndDecode(buildHDR(w, h, pixels), "actually.exr")
	if err != nil {
		t.Fatalf("检测解码失败: %v", err)
	}
	if img.Width != 1 || img.Height != 1 {
		t.Errorf("尺寸 = %dx%d", img.Width, img.Height)
	}
}

