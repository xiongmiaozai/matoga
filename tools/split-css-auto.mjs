/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 自动按分节标记切分大 CSS（仓库脚本）。
 *
 * 策略：
 * 1. 扫描顶层分节标记（/* ═══ 或 /* ── ），得到分节边界；
 * 2. 按顺序累积分节，超过 maxLines 就另起一个分片；
 * 3. 每个分片都在顶层选择器之间切开，保证层叠顺序不变；
 * 4. 原文件改写为 @import 入口，版权头注释保留在入口；
 * 5. 核对分片总行数 == 原文件正文行数，不一致直接失败。
 *
 * 用法：node tools/run-split-css.mjs <源文件> <输出目录> <前缀> [maxLines]
 */

import fs from 'node:fs'
import path from 'node:path'

/** 分节标记正则：═ 或 ─ 组成的分隔线 */
const SECTION_RE = /^\/\*\s*(?:═{10,}|─{2,})/

/**
 * 找出所有分节起始行（1-based）。
 * @param {string[]} lines
 * @returns {number[]}
 */
export function findSectionStarts(lines) {
  const starts = []
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) starts.push(i + 1)
  }
  if (!starts.length || starts[0] !== 1) starts.unshift(1)
  return [...new Set(starts)].sort((a, b) => a - b)
}

/**
 * 把分节聚合成分片，每片尽量接近但不超过 maxLines。
 * @param {number[]} starts 分节起始行
 * @param {number} total 正文总行数
 * @param {number} maxLines
 * @returns {Array<{start: number, end: number}>}
 */
export function groupSections(starts, total, maxLines) {
  const bounds = [...starts, total + 1]
  const parts = []
  let curStart = bounds[0]
  for (let i = 1; i < bounds.length; i++) {
    const sectionEnd = bounds[i] - 1
    const prevSectionStart = bounds[i - 1]
    if (sectionEnd - curStart + 1 > maxLines && prevSectionStart - 1 >= curStart) {
      parts.push({ start: curStart, end: prevSectionStart - 1 })
      curStart = prevSectionStart
    }
  }
  if (curStart <= total) parts.push({ start: curStart, end: total })
  return parts
}

/**
 * 校验分片完整覆盖 [1, total]。
 * @param {Array<{start: number, end: number}>} parts
 * @param {number} total
 */
export function assertCoverage(parts, total) {
  const sorted = [...parts].sort((a, b) => a.start - b.start)
  let expect = 1
  for (const p of sorted) {
    if (p.start !== expect) throw new Error(`覆盖不连续：期望 ${expect}，实际 ${p.start}`)
    expect = p.end + 1
  }
  if (expect !== total + 1) throw new Error(`覆盖不完整：结束于 ${expect - 1}，共 ${total} 行`)
}

/**
 * 把标题转成安全的文件名片段。
 * @param {string} t
 * @returns {string}
 */
function slug(t) {
  const s = t
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/g, '')
  return s || 'part'
}

/**
 * 从分片内容里提取一个可读的名字。
 * @param {string} body
 * @returns {string}
 */
export function partName(body) {
  const lines = body.split(/\r?\n/)
  // 跳过前导空行
  let s = 0
  while (s < lines.length && lines[s].trim() === '') s++

  // 形式一：═══ / ── 分隔线 + 标题行
  if (SECTION_RE.test(lines[s] || '')) {
    const t = (lines[s + 1] || '')
      .replace(/^\s*\*?\s*/, '')
      .replace(/\s*(?:═+|─+|\*\/)\s*$/, '')
      .trim()
    if (t) return slug(t)
  }
  // 形式二：单行块注释 /* 标题 */
  const m = (lines[s] || '').match(/^\/\*\s*([^\n*]{2,60}?)\s*\*\//)
  if (m) return slug(m[1])

  // 形式三：向下找第一个分节注释或选择器，避免一批分片全叫 part
  for (let i = s; i < Math.min(s + 40, lines.length); i++) {
    const line = lines[i]
    if (SECTION_RE.test(line)) {
      const t = (lines[i + 1] || '')
        .replace(/^\s*\*?\s*/, '')
        .replace(/\s*(?:═+|─+|\*\/)\s*$/, '')
        .trim()
      if (t) return slug(t)
    }
    const cm = line.match(/^\/\*\s*([^\n*]{2,60}?)\s*\*\//)
    if (cm) return slug(cm[1])
    const sel = line.match(/^([.#][\w-]+|:root|html|body|@[\w-]+)/)
    if (sel) return slug(sel[1] + (i > s ? '-head' : ''))
  }
  return 'part'
}

/**
 * 抽取源文件开头的块注释。
 * @param {string[]} lines
 * @param {string} eol
 * @returns {{head: string, skipLines: number}}
 */
export function extractLeadingComment(lines, eol) {
  // 找到第一个非空行：文件可能以空行开头（如 node-canvas.css）
  let p = 0
  while (p < lines.length && lines[p].trim() === '') p++
  const firstLine = lines[p] || ''
  // 只有「文件最前面的块注释」才算文件头：
  //   - /** ... */ 形式的文档头
  //   - /* ═══ ... ═══ */ 形式且未在本行闭合的文件级标题
  // 单行完整注释（如 /* ── 顶栏按钮 ── */）是分节标记，必须留在分片内。
  const isDocHead = /^\/\*\*/.test(firstLine)
  const isUnclosedBlock = /^\/\*/.test(firstLine) && !/\*\//.test(firstLine)
  if (!isDocHead && !isUnclosedBlock) return { head: '', skipLines: 0 }
  for (let i = p; i < lines.length; i++) {
    if (/\*\/\s*$/.test(lines[i])) {
      // head 含前导空行与注释本身；正文从注释下一行开始（其后的空行留在正文里）
      return { head: lines.slice(0, i + 1).join(eol), skipLines: i + 1 }
    }
  }
  return { head: '', skipLines: 0 }
}

/**
 * 主流程。
 * @param {string} src
 * @param {string} outDir
 * @param {string} prefix
 * @param {number} maxLines
 */
export function splitAuto(src, outDir, prefix, maxLines = 300) {
  const text = fs.readFileSync(src, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const allLines = text.split(/\r?\n/)
  if (allLines[allLines.length - 1] === '') allLines.pop()
  const total = allLines.length

  const { head, skipLines } = extractLeadingComment(allLines, eol)
  const body = skipLines > 0 ? allLines.slice(skipLines) : allLines
  const bodyTotal = body.length

  const starts = findSectionStarts(body)
  const parts = groupSections(starts, bodyTotal, maxLines)
  assertCoverage(parts, bodyTotal)

  fs.mkdirSync(outDir, { recursive: true })
  const dirName = path.basename(outDir)
  const written = []
  const imports = []
  let covered = 0
  parts.forEach((p, i) => {
    const chunk = body.slice(p.start - 1, p.end).join(eol)
    covered += p.end - p.start + 1
    const fileName = `${prefix}-${String(i + 1).padStart(2, '0')}-${partName(chunk)}.css`
    // 分片内容原样落盘，不再追加行尾换行：
    // 各分片末尾保留原有的空行结构，@import 展开后可与原文件逐字符对齐。
    fs.writeFileSync(path.join(outDir, fileName), chunk, 'utf8')
    written.push(fileName)
    imports.push(`@import './${dirName}/${fileName}';`)
  })
  if (covered !== bodyTotal) {
    throw new Error(`行数核对失败：分片 ${covered} 行，正文 ${bodyTotal} 行`)
  }

  // 入口 = 文件头注释 + 一行说明 + 全部 @import。
  // 不额外插入空行：这样入口展开（把 @import 换成分片内容）后，
  // 与拆分前的原文件逐字符一致，层叠结果可证等价。
  const entry = [
    head || `/* ${prefix} — 分片入口 */`,
    '/* 分片入口：顺序 = 原行号升序，层叠结果与拆分前等价 */',
    ...imports
  ].join(eol)
  fs.writeFileSync(src, entry + eol, 'utf8')
  return { total, headLines: skipLines, parts: parts.length, files: written, covered }
}
