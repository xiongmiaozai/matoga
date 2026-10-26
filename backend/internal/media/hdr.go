// matoga - 材质贴图对比工具
// Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
// SPDX-License-Identifier: MIT

package media

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

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

// DecodeEXR 解析 OpenEXR（支持 none/rle/zips/zip 压缩，非 tiled/deep）。
func DecodeEXR(buf []byte) (*Image, error) {
	const exrMagic = 20000630
	if len(buf) < 8 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: too short")
	}
	if binary.LittleEndian.Uint32(buf[0:4]) != exrMagic {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: bad magic")
	}
	version := binary.LittleEndian.Uint32(buf[4:8])
	if version&0x200 != 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: tiled not supported")
	}
	if version&0x4000 != 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: deep not supported")
	}

	pos := 8
	type exrChannel struct {
		Name      string
		PixelType int32
	}
	var channels []exrChannel
	var dataWindow [4]int32
	var compression int
	haveCompression := false
	haveWindow := false

	readNullStr := func(p int) (string, int) {
		start := p
		for p < len(buf) && buf[p] != 0 {
			p++
		}
		return string(buf[start:p]), p + 1
	}

	for pos < len(buf) {
		name, p1 := readNullStr(pos)
		pos = p1
		if name == "" {
			break
		}
		typ, p2 := readNullStr(pos)
		pos = p2
		if pos+4 > len(buf) {
			return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: truncated attr")
		}
		size := int(binary.LittleEndian.Uint32(buf[pos : pos+4]))
		pos += 4
		start := pos
		if start+size > len(buf) {
			return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: attr overflow")
		}
		switch typ {
		case "compression":
			if size >= 1 {
				compression = int(buf[start])
				haveCompression = true
			}
		case "box2i":
			if name == "dataWindow" && size >= 16 {
				dataWindow[0] = int32(binary.LittleEndian.Uint32(buf[start : start+4]))
				dataWindow[1] = int32(binary.LittleEndian.Uint32(buf[start+4 : start+8]))
				dataWindow[2] = int32(binary.LittleEndian.Uint32(buf[start+8 : start+12]))
				dataWindow[3] = int32(binary.LittleEndian.Uint32(buf[start+12 : start+16]))
				haveWindow = true
			}
		case "chlist":
			cp := start
			for cp < start+size {
				cn, cnp := readNullStr(cp)
				cp = cnp
				if cn == "" {
					break
				}
				if cp+16 > len(buf) {
					break
				}
				pt := int32(binary.LittleEndian.Uint32(buf[cp : cp+4]))
				cp += 16
				channels = append(channels, exrChannel{Name: cn, PixelType: pt})
			}
		}
		pos = start + size
	}

	if !haveCompression {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: missing compression")
	}
	if compression > 3 {
		return nil, httpx.Errorf(httpx.CodeFS, fmt.Sprintf("EXR decode: compression %d not supported (use none/rle/zips/zip)", compression))
	}
	if !haveWindow {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: missing dataWindow")
	}
	if len(channels) == 0 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: missing channels")
	}

	xMin, yMin, xMax, yMax := int(dataWindow[0]), int(dataWindow[1]), int(dataWindow[2]), int(dataWindow[3])
	width := xMax - xMin + 1
	height := yMax - yMin + 1
	if width <= 0 || height <= 0 || width*height > 1<<28 {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: bad dimensions")
	}

	linesPerBlock := 1
	if compression == 3 {
		linesPerBlock = 16
	}
	numBlocks := (height + linesPerBlock - 1) / linesPerBlock
	if pos+numBlocks*8 > len(buf) {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: offset table truncated")
	}
	offsets := make([]int64, numBlocks)
	for i := 0; i < numBlocks; i++ {
		lo := int64(binary.LittleEndian.Uint32(buf[pos : pos+4]))
		hi := int64(binary.LittleEndian.Uint32(buf[pos+4 : pos+8]))
		offsets[i] = hi*0x100000000 + lo
		pos += 8
	}

	channelIndex := make([]int, len(channels))
	for i := range channelIndex {
		channelIndex[i] = -1
	}
	hasColor := [3]bool{}
	for i, ch := range channels {
		switch strings.ToUpper(ch.Name) {
		case "R":
			channelIndex[i] = 0
			hasColor[0] = true
		case "G":
			channelIndex[i] = 1
			hasColor[1] = true
		case "B":
			channelIndex[i] = 2
			hasColor[2] = true
		case "A":
			channelIndex[i] = 3
		}
	}

	data := make([]float32, width*height*4)
	sampleBytes := func(pt int32) int {
		if pt == 1 {
			return 2
		}
		return 4
	}

	for b := 0; b < numBlocks; b++ {
		bp := int(offsets[b])
		if bp+8 > len(buf) {
			break
		}
		yCoord := int(int32(binary.LittleEndian.Uint32(buf[bp : bp+4])))
		bp += 4
		psize := int(int32(binary.LittleEndian.Uint32(buf[bp : bp+4])))
		bp += 4
		if bp+psize > len(buf) {
			psize = len(buf) - bp
		}
		rowsInBlock := linesPerBlock
		if yMax-yCoord+1 < linesPerBlock {
			rowsInBlock = yMax - yCoord + 1
		}
		if rowsInBlock <= 0 {
			continue
		}

		var decoded []byte
		switch compression {
		case 0:
			decoded = buf[bp : bp+psize]
		case 1:
			total := 0
			for _, ch := range channels {
				total += sampleBytes(ch.PixelType) * width * rowsInBlock
			}
			outBuf := make([]byte, total)
			dp, off := bp, 0
			for r := 0; r < rowsInBlock; r++ {
				for _, ch := range channels {
					tlen := sampleBytes(ch.PixelType) * width
					d, next, err := exrRLEDecode(buf, dp, tlen)
					if err != nil {
						return nil, err
					}
					copy(outBuf[off:], d)
					off += tlen
					dp = next
				}
			}
			decoded = outBuf
		default:
			inflated, err := inflate(buf[bp : bp+psize])
			if err != nil {
				return nil, err
			}
			decoded = inflated
			off := 0
			for _, ch := range channels {
				cl := sampleBytes(ch.PixelType) * width * rowsInBlock
				reversePrediction(decoded, off, cl)
				off += cl
			}
		}

		if compression == 1 {
			off := 0
			for r := 0; r < rowsInBlock; r++ {
				y := yCoord - yMin + r
				for ci, ch := range channels {
					sb := sampleBytes(ch.PixelType)
					target := channelIndex[ci]
					if target >= 0 {
						for x := 0; x < width; x++ {
							if idx := (y*width + x) * 4; idx+target < len(data) {
								data[idx+target] = readSample(decoded, off+x*sb, ch.PixelType)
							}
						}
					}
					off += sb * width
				}
			}
		} else {
			off := 0
			for ci, ch := range channels {
				sb := sampleBytes(ch.PixelType)
				target := channelIndex[ci]
				if target >= 0 {
					for r := 0; r < rowsInBlock; r++ {
						y := yCoord - yMin + r
						rowOff := off + r*sb*width
						for x := 0; x < width; x++ {
							if idx := (y*width + x) * 4; idx+target < len(data) {
								data[idx+target] = readSample(decoded, rowOff+x*sb, ch.PixelType)
							}
						}
					}
				}
				off += sb * width * rowsInBlock
			}
		}
	}

	for i := 0; i < width*height; i++ {
		if !hasColor[0] {
			data[i*4] = 0
		}
		if !hasColor[1] {
			data[i*4+1] = 0
		}
		if !hasColor[2] {
			data[i*4+2] = 0
		}
		if data[i*4+3] == 0 {
			data[i*4+3] = 1
		}
	}
	return &Image{Width: width, Height: height, Data: data, Format: "EXR"}, nil
}

func exrRLEDecode(src []byte, p, targetLen int) ([]byte, int, error) {
	out := make([]byte, targetLen)
	o := 0
	for o < targetLen {
		if p >= len(src) {
			return nil, p, httpx.Errorf(httpx.CodeFS, "EXR decode: rle truncated")
		}
		count := int(src[p])
		p++
		if count < 128 {
			if p >= len(src) {
				return nil, p, httpx.Errorf(httpx.CodeFS, "EXR decode: rle truncated")
			}
			val := src[p]
			p++
			n := count + 1
			for k := 0; k < n && o < targetLen; k++ {
				out[o] = val
				o++
			}
		} else {
			n := 257 - count
			for k := 0; k < n && o < targetLen; k++ {
				if p >= len(src) {
					return nil, p, httpx.Errorf(httpx.CodeFS, "EXR decode: rle truncated")
				}
				out[o] = src[p]
				o++
				p++
			}
		}
	}
	return out, p, nil
}

func reversePrediction(buf []byte, start, length int) {
	for i := 1; i < length && start+i < len(buf); i++ {
		buf[start+i] = buf[start+i] + buf[start+i-1]
	}
}

func inflate(src []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(src))
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: inflate failed: "+err.Error())
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return nil, httpx.Errorf(httpx.CodeFS, "EXR decode: inflate read failed")
	}
	return out, nil
}

func readSample(decoded []byte, off int, pixelType int32) float32 {
	switch pixelType {
	case 1: // half
		if off+2 > len(decoded) {
			return 0
		}
		return halfToFloat(uint16(decoded[off]) | uint16(decoded[off+1])<<8)
	case 2: // float
		if off+4 > len(decoded) {
			return 0
		}
		return math.Float32frombits(binary.LittleEndian.Uint32(decoded[off : off+4]))
	default: // uint
		if off+4 > len(decoded) {
			return 0
		}
		return float32(binary.LittleEndian.Uint32(decoded[off : off+4]))
	}
}

func halfToFloat(h uint16) float32 {
	s := uint32(h>>15) & 0x1
	e := uint32(h>>10) & 0x1f
	m := uint32(h) & 0x3ff
	if e == 0 {
		if m == 0 {
			if s == 1 {
				return float32(math.Copysign(0, -1))
			}
			return 0
		}
		v := math.Pow(2, -14) * (float64(m) / 1024)
		if s == 1 {
			v = -v
		}
		return float32(v)
	}
	if e == 31 {
		if m != 0 {
			return float32(math.NaN())
		}
		if s == 1 {
			return float32(math.Inf(-1))
		}
		return float32(math.Inf(1))
	}
	v := math.Pow(2, float64(int(e)-15)) * (1 + float64(m)/1024)
	if s == 1 {
		v = -v
	}
	return float32(v)
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
