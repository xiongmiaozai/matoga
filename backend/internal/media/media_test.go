// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"encoding/binary"
	"image/png"
	"strings"
	"testing"
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
	// 4×3 分量：1 + 4 + (12-1)*2 = 27 字符
	if len(hash) != 27 {
		t.Fatalf("blurhash 长度 = %d (%q), want 27", len(hash), hash)
	}
	if strings.ContainsAny(hash, " \t\n") {
		t.Errorf("blurhash 不应含空白: %q", hash)
	}
	// 首字符编码 cx-1 + (cy-1)<<4 = 3 + 32 = 35 → base83 第 35 位
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"
	if hash[0] != chars[35] {
		t.Errorf("首字符 = %q, want %q", hash[0], chars[35])
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

func TestHalfToFloatKnownValues(t *testing.T) {
	cases := []struct {
		in   uint16
		want float32
	}{
		{0x0000, 0},
		{0x3C00, 1},   // 1.0
		{0x4000, 2},   // 2.0
		{0xBC00, -1},  // -1.0
		{0x3555, 0.33325},
	}
	for _, c := range cases {
		got := halfToFloat(c.in)
		diff := got - c.want
		if diff > 1e-4 || diff < -1e-4 {
			t.Errorf("halfToFloat(%#04x) = %v, want %v", c.in, got, c.want)
		}
	}
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

