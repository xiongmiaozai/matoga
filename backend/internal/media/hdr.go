// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/mdouchement/hdr"
	"github.com/mdouchement/hdr/codec/rgbe"
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

// DecodeHDR 解析 Radiance RGBE（.hdr）。底层由 mdouchement/hdr 处理，
// 支持 RLE / 简单扫描线 / EXPOSURE 标签。
//
// 注意：本库按 Radiance 规范用 2^(e-128)/256 换算，而旧 Node 实现用 /255，
// 两者相差 0.4% 的全局常数因子；tonemap 会按平均亮度自动曝光，该因子被抵消。
func DecodeHDR(buf []byte) (*Image, error) {
	decoded, err := rgbe.Decode(bytes.NewReader(buf))
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("HDR decode: %v", err))
	}
	src, ok := decoded.(*hdr.RGB)
	if !ok {
		return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: unsupported image mode (only RGBE)")
	}
	rect := src.Rect
	width, height := rect.Dx(), rect.Dy()
	if width <= 0 || height <= 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "HDR decode: bad dimensions")
	}
	data := make([]float32, width*height*4)
	for y := 0; y < height; y++ {
		row := (y-rect.Min.Y)*src.Stride + (0-rect.Min.X)*3
		for x := 0; x < width; x++ {
			si := row + x*3
			di := (y*width + x) * 4
			data[di] = float32(src.Pix[si])
			data[di+1] = float32(src.Pix[si+1])
			data[di+2] = float32(src.Pix[si+2])
			data[di+3] = 1
		}
	}
	return &Image{Width: width, Height: height, Data: data, Format: "HDR (RGBE)"}, nil
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
