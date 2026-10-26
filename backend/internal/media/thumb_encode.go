// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"image"
	"image/png"
	"math"
)

// aces 是 ACES 色调映射曲线。
func aces(c float64) float64 {
	v := (c * (2.51*c + 0.03)) / (c*(2.43*c+0.59) + 0.14)
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// srgbEncode 把线性值编码为 sRGB。
func srgbEncode(c float64) float64 {
	if c < 0 {
		c = 0
	} else if c > 1 {
		c = 1
	}
	if c <= 0.0031308 {
		return c * 12.92
	}
	return 1.055*math.Pow(c, 1/2.4) - 0.055
}

// TonemapToRGBA 把线性浮点图转成 8 位 RGBA（自动曝光）。
func TonemapToRGBA(width, height int, data []float32) []byte {
	out := make([]byte, width*height*4)
	logSum, logCount := 0.0, 0
	n := width * height
	for i := 0; i < n; i++ {
		lum := 0.2126*float64(data[i*4]) + 0.7152*float64(data[i*4+1]) + 0.0722*float64(data[i*4+2])
		if lum > 1e-6 {
			logSum += math.Log(lum)
			logCount++
		}
	}
	logAvg := 0.0
	if logCount > 0 {
		logAvg = logSum / float64(logCount)
	}
	exp := math.Exp(-logAvg) * 0.18
	for i := 0; i < n; i++ {
		out[i*4] = clampByte(math.Round(srgbEncode(aces(float64(data[i*4])*exp)) * 255))
		out[i*4+1] = clampByte(math.Round(srgbEncode(aces(float64(data[i*4+1])*exp)) * 255))
		out[i*4+2] = clampByte(math.Round(srgbEncode(aces(float64(data[i*4+2])*exp)) * 255))
		out[i*4+3] = 255
	}
	return out
}

func clampByte(v float64) byte {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return byte(v)
}

// Downsample 盒式降采样（与 Node 版像素区间算法一致）。
func Downsample(srcW, srcH int, data []float32, dstW, dstH int) []float32 {
	out := make([]float32, dstW*dstH*4)
	for dy := 0; dy < dstH; dy++ {
		sy0 := dy * srcH / dstH
		sy1 := maxInt(sy0+1, minInt(srcH, (dy+1)*srcH/dstH))
		for dx := 0; dx < dstW; dx++ {
			sx0 := dx * srcW / dstW
			sx1 := maxInt(sx0+1, minInt(srcW, (dx+1)*srcW/dstW))
			var r, g, b, a float64
			for yy := sy0; yy < sy1; yy++ {
				for xx := sx0; xx < sx1; xx++ {
					si := (yy*srcW + xx) * 4
					r += float64(data[si])
					g += float64(data[si+1])
					b += float64(data[si+2])
					a += float64(data[si+3])
				}
			}
			cnt := float64((sy1 - sy0) * (sx1 - sx0))
			di := (dy*dstW + dx) * 4
			out[di] = float32(r / cnt)
			out[di+1] = float32(g / cnt)
			out[di+2] = float32(b / cnt)
			out[di+3] = float32(a / cnt)
		}
	}
	return out
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// EncodePNG 把 RGBA 字节编码为 PNG。
func EncodePNG(width, height int, rgba []byte) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	copy(img.Pix, rgba)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// blurChars 是 blurhash 的 base83 字符表。
const blurChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"

func encode83(n, length int) string {
	s := make([]byte, length)
	for i := length; i >= 1; i-- {
		s[i-1] = blurChars[n%83]
		n /= 83
	}
	return string(s)
}

func sRGBToLinear(v float64) float64 {
	v = math.Max(0, math.Min(1, v))
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func linearTosRGB(v float64) float64 {
	v = math.Max(0, math.Min(1, v))
	if v <= 0.0031308 {
		return v * 12.92
	}
	return 1.055*math.Pow(v, 1/2.4) - 0.055
}

func encodeDC(v float64) int { return int(math.Round(linearTosRGB(v) * 255)) }

func encodeAC(v float64) int {
	sign := 1.0
	abs := v
	if v < 0 {
		sign = -1
		abs = -v
	}
	raw := 9 + 9*sign*math.Pow(abs, 0.5)
	return int(math.Max(0, math.Min(18, math.Round(raw))))
}

func rgbaDownsample(srcW, srcH int, rgba []byte, dstW, dstH int) []byte {
	out := make([]byte, dstW*dstH*4)
	for dy := 0; dy < dstH; dy++ {
		sy0 := dy * srcH / dstH
		sy1 := maxInt(sy0+1, minInt(srcH, (dy+1)*srcH/dstH))
		for dx := 0; dx < dstW; dx++ {
			sx0 := dx * srcW / dstW
			sx1 := maxInt(sx0+1, minInt(srcW, (dx+1)*srcW/dstW))
			var r, g, b, n float64
			for yy := sy0; yy < sy1; yy++ {
				for xx := sx0; xx < sx1; xx++ {
					idx := (yy*srcW + xx) * 4
					if idx+2 >= len(rgba) {
						continue
					}
					r += float64(rgba[idx])
					g += float64(rgba[idx+1])
					b += float64(rgba[idx+2])
					n++
				}
			}
			di := (dy*dstW + dx) * 4
			if n > 0 {
				out[di] = byte(r / n)
				out[di+1] = byte(g / n)
				out[di+2] = byte(b / n)
			}
			out[di+3] = 255
		}
	}
	return out
}

// EncodeBlurhash 生成 blurhash 字符串（cx×cy 个分量）。
func EncodeBlurhash(rgba []byte, width, height, cx, cy int) string {
	if cx <= 0 {
		cx = 4
	}
	if cy <= 0 {
		cy = 3
	}
	factor := func(x, y int) [3]float64 {
		var r, g, b float64
		nx, ny := 2.0, 2.0
		if x == 0 {
			nx = 1
		}
		if y == 0 {
			ny = 1
		}
		for j := 0; j < height; j++ {
			for i := 0; i < width; i++ {
				c := math.Cos(math.Pi*float64(x)*float64(i)/float64(width)) *
					math.Cos(math.Pi*float64(y)*float64(j)/float64(height))
				idx := (j*width + i) * 4
				if idx+2 >= len(rgba) {
					continue
				}
				r += c * sRGBToLinear(float64(rgba[idx])/255)
				g += c * sRGBToLinear(float64(rgba[idx+1])/255)
				b += c * sRGBToLinear(float64(rgba[idx+2])/255)
			}
		}
		s := nx * ny / float64(width*height)
		return [3]float64{r * s, g * s, b * s}
	}

	hash := encode83((cx-1)+((cy-1)<<4), 1)
	dc := factor(0, 0)
	hash += encode83((encodeDC(dc[0])<<16)|(encodeDC(dc[1])<<8)|encodeDC(dc[2]), 4)
	for y := 0; y < cy; y++ {
		for x := 0; x < cx; x++ {
			if x == 0 && y == 0 {
				continue
			}
			f := factor(x, y)
			hash += encode83(encodeAC(f[0])*361+encodeAC(f[1])*19+encodeAC(f[2]), 2)
		}
	}
	return hash
}

// ThumbResult 是 HDR 缩略图生成结果。
type ThumbResult struct {
	PNG       []byte
	Blurhash  string
	Width     int
	Height    int
	SrcWidth  int
	SrcHeight int
	Format    string
}

// GenerateThumb 从 HDR/EXR 字节生成缩略图 PNG + blurhash。
func GenerateThumb(buf []byte, ext string, maxW, maxH int) (*ThumbResult, error) {
	img, err := DecodeByExt(buf, ext)
	if err != nil {
		return nil, err
	}
	ratio := math.Min(math.Min(float64(maxW)/float64(img.Width), float64(maxH)/float64(img.Height)), 1)
	tw := maxInt(1, int(math.Round(float64(img.Width)*ratio)))
	th := maxInt(1, int(math.Round(float64(img.Height)*ratio)))

	sampled := img.Data
	if tw != img.Width || th != img.Height {
		sampled = Downsample(img.Width, img.Height, img.Data, tw, th)
	}
	rgba := TonemapToRGBA(tw, th, sampled)
	bhRgba := rgbaDownsample(tw, th, rgba, 32, 16)
	blurhash := EncodeBlurhash(bhRgba, 32, 16, 4, 3)
	pngBytes, err := EncodePNG(tw, th, rgba)
	if err != nil {
		return nil, err
	}
	return &ThumbResult{
		PNG:       pngBytes,
		Blurhash:  blurhash,
		Width:     tw,
		Height:    th,
		SrcWidth:  img.Width,
		SrcHeight: img.Height,
		Format:    img.Format,
	}, nil
}
