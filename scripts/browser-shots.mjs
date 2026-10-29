/**
 * matoga - 浏览器实测截图留证
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 走核心流程并逐页截图，存到 docs/verification/ 供人工复核。
 * 用法：node scripts/browser-shots.mjs <baseUrl> [outDir]
 */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:5273'
const OUT = process.argv[3] || 'docs/verification'

fs.mkdirSync(OUT, { recursive: true })

const shots = []
const errors = []

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } })
const page = await ctx.newPage()

page.on('console', (m) => { if (m.type() === 'error') errors.push({ kind: 'console', text: m.text().slice(0, 200), url: page.url() }) })
page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: String(e.message || e).slice(0, 200), url: page.url() }))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push({ kind: 'http', text: r.status() + ' ' + r.url().slice(0, 160), url: page.url() }) })

async function shot(name) {
  const file = path.join(OUT, name + '.png')
  await page.screenshot({ path: file, fullPage: false })
  shots.push(name + '.png')
  console.log('  截图: ' + file)
}

async function ready() {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
}

// 1. 首页
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await ready()
await shot('01-home')

// 2. 停靠布局面板
const panelCount = await page.locator('.lm-item, [data-panel]').count()
console.log('  面板数: ' + panelCount)

// 3. 资产库面板
const assetBtn = page.locator('#assetLibraryBtn, button:has-text("资产")').first()
if (await assetBtn.count()) {
  await assetBtn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await shot('02-asset-library')
}

// 4. 主题编辑器
const themeBtn = page.locator('[data-panel="themeEditor"], button:has-text("主题"), #themeBtn').first()
if (await themeBtn.count()) {
  await themeBtn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await shot('03-theme-editor')
}

// 5. 节点编辑器
await page.goto(BASE + '/node-editor.html', { waitUntil: 'domcontentloaded', timeout: 30000 })
await ready()
await shot('04-node-editor')
const nodesBefore = await page.locator('.node, [data-node]').count()

// 6. 节点编辑器：添加节点
const libItem = page.locator('#library .lib-item, #library [data-type]').first()
if (await libItem.count()) {
  await libItem.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(900)
  const nodesAfter = await page.locator('.node, [data-node]').count()
  console.log('  节点数: ' + nodesBefore + ' -> ' + nodesAfter)
  await shot('05-node-added')
}

// 7. 回首页确认
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await ready()
await shot('06-home-final')

await browser.close()

const summary = {
  base: BASE,
  outDir: OUT,
  shots,
  panelCount,
  errorCount: errors.length,
  errors: errors.slice(0, 20),
}
console.log('\n' + JSON.stringify(summary, null, 2))
console.log('\n=== 截图 ' + shots.length + ' 张，错误 ' + errors.length + ' 个 ===')
process.exit(errors.length ? 1 : 0)
