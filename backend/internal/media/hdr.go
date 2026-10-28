// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/mrjoshuak/go-openexr/exr"
	"github.com/xiongmiaozai/matoga/backend/internal/httpx"
)

// Image 是解码后的线性浮点图像（RGBA，行优先）。
type Image struct {
	Width  int
	Height int
	Data   []float32
	Format string
}

// DecodeHDR 解析 Radiance RGBE（.hdr）。
func DecodeHDR(buf []byte) (*Image, error) {
	pos := 0
	readLine := func() string {
		start := pos
		for pos < len(buf) && buf[pos] != '\n' {
			pos++
		}
		s := string(buf[start:pos])
		pos++ // 跳过 \n
		return s
	}

	first := readLine()
	if !strings.HasPrefix(first, "#?") {
		return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: bad magic")
	}

	width, height := 0, 0
	for pos < len(buf) {
		line := readLine()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "FORMAT=") {
			continue
		}
		// 只支持 -Y H +X W 的常见布局
		if strings.HasPrefix(trimmed, "-Y") {
			fields := strings.Fields(trimmed)
			if len(fields) >= 4 {
				h, err1 := strconv.Atoi(fields[1])
				w, err2 := strconv.Atoi(fields[3])
				if err1 == nil && err2 == nil {
					height, width = h, w
					break
				}
			}
		}
	}
	if width <= 0 || height <= 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: missing dimensions")
	}
	rgba, err := hdrRLE(buf[pos:], width, height)
	if err != nil {
		return nil, err
	}
	data := make([]float32, width*height*4)
	n := width * height
	for j := 0; j < n && j*4+3 < len(rgba); j++ {
		e := rgba[j*4+3]
		scale := float32(math.Pow(2, float64(int(e)-128)) / 255)
		data[j*4] = float32(rgba[j*4]) * scale
		data[j*4+1] = float32(rgba[j*4+1]) * scale
		data[j*4+2] = float32(rgba[j*4+2]) * scale
		data[j*4+3] = 1
	}
	return &Image{Width: width, Height: height, Data: data, Format: "HDR (RGBE)"}, nil
}

func hdrRLE(src []byte, w, h int) ([]byte, error) {
	// 未压缩：直接返回（同时补足长度以便后续按 4*w*h 读取）
	uncompressed := w < 8 || w > 0x7fff || len(src) < 3 || src[0] != 2 || src[1] != 2 || src[2]&0x80 != 0
	if uncompressed {
		need := 4 * w * h
		if len(src) < need {
			fixed := make([]byte, need)
			copy(fixed, src)
			return fixed, nil
		}
		return src[:need], nil
	}

	out := make([]byte, 4*w*h)
	srcPos := 0
	outPos := 0
	ptrEnd := 4 * w
	sl := make([]byte, ptrEnd)
	start := make([]byte, 4)
	num := h
	for num > 0 && srcPos < len(src) {
		if srcPos+4 > len(src) {
			break
		}
		copy(start, src[srcPos:srcPos+4])
		srcPos += 4
		ptr := 0
		for ptr < ptrEnd && srcPos < len(src) {
			count := int(src[srcPos])
			srcPos++
			enc := count > 128
			if enc {
				count -= 128
			}
			if count == 0 || ptr+count > ptrEnd {
				return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: bad scanline")
			}
			if enc {
				if srcPos >= len(src) {
					return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: truncated")
				}
				v := src[srcPos]
				srcPos++
				for i := 0; i < count; i++ {
					sl[ptr] = v
					ptr++
				}
			} else {
				if srcPos+count > len(src) {
					return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: truncated")
				}
				copy(sl[ptr:], src[srcPos:srcPos+count])
				ptr += count
				srcPos += count
			}
		}
		for i := 0; i < w; i++ {
			o := 0
			out[outPos] = sl[i+o]
			o += w
			out[outPos+1] = sl[i+o]
			o += w
			out[outPos+2] = sl[i+o]
			o += w
			out[outPos+3] = sl[i+o]
			outPos += 4
		}
		num--
	}
	return out, nil
}

// DecodeEXR 解析 OpenEXR。底层由 mrjoshuak/go-openexr 处理，
// 支持 tiled/deep 与全部官方压缩（none/rle/zips/zip/piz/pxr24/b44/dwaa/dwab）。
func DecodeEXR(buf []byte) (*Image, error) {
	if len(buf) < 8 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: too short")
	}
	img, err := exr.Decode(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("EXR decode: %v", err))
	}
	rect := img.Bounds()
	width, height := rect.Dx(), rect.Dy()
	if width <= 0 || height <= 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: bad dimensions")
	}
	data := make([]float32, width*height*4)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			r, g, b, a := img.RGBA(rect.Min.X+x, rect.Min.Y+y)
			di := (y*width + x) * 4
			data[di] = r
			data[di+1] = g
			data[di+2] = b
			data[di+3] = a
		}
	}
	// 与 Node 版一致：alpha 缺失时补 1
	for i := 0; i < width*height; i++ {
		if data[i*4+3] == 0 {
			data[i*4+3] = 1
		}
	}
	return &Image{Width: width, Height: height, Data: data, Format: "EXR"}, nil
}

// DecodeByExt 按扩展名选择解码器。
func DecodeByExt(buf []byte, ext string) (*Image, error) {
	if strings.EqualFold(ext, "exr") {
		return DecodeEXR(buf)
	}
	return DecodeHDR(buf)
}

// DetectAndDecode 按魔数猜格式，失败再退回扩展名。
func DetectAndDecode(buf []byte, filename string) (*Image, error) {
	if len(buf) >= 4 && buf[0] == 0x76 && buf[1] == 0x2f && buf[2] == 0x31 && buf[3] == 0x01 {
		return DecodeEXR(buf)
	}
	if len(buf) >= 2 && buf[0] == 0x23 && buf[1] == 0x3f {
		return DecodeHDR(buf)
	}
	ext := filename
	if i := strings.LastIndex(filename, "."); i >= 0 {
		ext = filename[i+1:]
	}
	return DecodeByExt(buf, ext)
}
