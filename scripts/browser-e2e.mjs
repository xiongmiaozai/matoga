/**
 * matoga - 浏览器全流程实测脚本
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 用真实 Chromium 走一遍核心功能，收集控制台报错、页面异常、失败请求。
 * 用法：node scripts/browser-e2e.mjs <baseUrl>
 */

import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5273'

const issues = []
const steps = []

function record(name, url, note) {
  steps.push({ name, url, note })
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } })
const page = await ctx.newPage()

// 收集各类错误
const consoleErrors = []
const pageErrors = []
const failedRequests = []

page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push({ text: msg.text().slice(0, 300), url: page.url() })
})
page.on('pageerror', err => {
  pageErrors.push({ text: String(err.message || err).slice(0, 300), url: page.url() })
})
page.on('requestfailed', req => {
  failedRequests.push({ url: req.url().slice(0, 200), why: req.failure()?.errorText })
})
page.on('response', async res => {
  if (res.status() >= 400 && !res.url().includes('favicon')) {
    failedRequests.push({ url: res.url().slice(0, 200), why: 'HTTP ' + res.status() })
  }
})

// 等待应用就绪（网络空闲 + 关键元素出现）
async function ready(timeout = 15000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
}

try {
  // ── 1. 首页加载 ──
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await ready()
  const title = await page.title()
  const hasHeader = await page.locator('.header, header').first().count()
  const hasTree = await page.locator('#resultTable, .result-wrap, .main').first().count()
  record('首页加载', page.url(), `title="${title}" header=${hasHeader} main=${hasTree}`)

  // ── 2. 核心 DOM 是否渲染 ──
  const keyEls = {
    leftTree: '#leftTree, .tree-left, [data-side="left"]',
    rightTree: '#rightTree, .tree-right, [data-side="right"]',
    compareBtn: '#compareBtn, .compare-btn, button:has-text("对比")',
    resultTable: '#resultTable',
    statusbar: '.statusbar, #statusbar'
  }
  const elPresence = {}
  for (const [k, sel] of Object.entries(keyEls)) {
    elPresence[k] = await page.locator(sel).first().count()
  }
  record('关键 DOM', page.url(), JSON.stringify(elPresence))

  // ── 3. 面板 / 停靠布局是否初始化 ──
  const layoutRoot = await page.locator('.lm-root, .layout-root, .workspace').first().count()
  const panelCount = await page.locator('.panel, .lm-item, [data-panel]').count()
  record('停靠布局', page.url(), `root=${layoutRoot} panels=${panelCount}`)

  // ── 4. 资产库面板 ──
  const assetBtn = page
    .locator('#assetLibraryBtn, .asset-library-btn, button:has-text("资产"), [title*="资产"]')
    .first()
  if (await assetBtn.count()) {
    await assetBtn.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const assetBody = await page.locator('#assetLibraryBody').count()
    const cards = await page.locator('.asset-card, .asset-item, .al-card').count()
    record('资产库', page.url(), `body=${assetBody} cards=${cards}`)
  } else {
    record('资产库', page.url(), '未找到入口按钮')
  }

  // ── 5. 节点编辑器页面 ──
  await page.goto(BASE + '/node-editor.html', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await ready()
  const neCanvas = await page.locator('#canvas-wrap, .canvas-wrap').first().count()
  const neLib = await page.locator('#library, .library').first().count()
  const neStatus = await page.locator('#statusbar, .statusbar').first().count()
  const neNodes = await page.locator('.node, [data-node]').count()
  record('节点编辑器', page.url(), `canvas=${neCanvas} library=${neLib} status=${neStatus} nodes=${neNodes}`)

  // ── 6. 节点编辑器交互：添加节点 ──
  const libItem = page.locator('#library .lib-item, #library [data-type], .lib-item').first()
  if (await libItem.count()) {
    await libItem.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(800)
    const nodesAfter = await page.locator('.node, [data-node]').count()
    record('添加节点', page.url(), `点击前=${neNodes} 点击后=${nodesAfter}`)
  }

  // ── 7. 回到首页做一次真实对比 ──
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await ready()
  // 尝试打开左侧目录选择
  const leftPick = page.locator('[data-side="left"] .pick-btn, #leftPickBtn, button:has-text("选择")').first()
  const compareClicked = await page
    .evaluate(() => {
      const b = document.querySelector('#compareBtn, .compare-btn')
      if (b) {
        b.click()
        return true
      }
      return false
    })
    .catch(() => false)
  record('对比触发', page.url(), `compareBtn 触发=${compareClicked} leftPick 存在=${await leftPick.count()}`)
  await page.waitForTimeout(2000)

  // ── 8. API 端点可用性（页面内发起）──
  const apiChecks = await page.evaluate(async () => {
    const out = {}
    for (const p of ['/api/health', '/api/config', '/api/panels', '/api/asset']) {
      try {
        const r = await fetch(p)
        out[p] = r.status
      } catch (e) {
        out[p] = 'ERR'
      }
    }
    return out
  })
  record('API 探测', page.url(), JSON.stringify(apiChecks))

  // ── 9. 主题编辑器面板 ──
  const themeBtn = page.locator('[data-panel="themeEditor"], button:has-text("主题"), #themeBtn').first()
  if (await themeBtn.count()) {
    await themeBtn.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1000)
    const themeGrid = await page.locator('#themeGrid, .theme-card').count()
    record('主题编辑器', page.url(), `cards=${themeGrid}`)
  } else record('主题编辑器', page.url(), '未找到入口')

  // ── 10. 最终截图 ──
  await page.screenshot({ path: 'scripts/.e2e-final.png', fullPage: false }).catch(() => {})
} catch (e) {
  issues.push({ stage: 'script', text: String(e.message || e).slice(0, 400) })
} finally {
  await browser.close()
}

// 汇总
const summary = {
  base: BASE,
  steps,
  consoleErrors: consoleErrors.slice(0, 30),
  pageErrors: pageErrors.slice(0, 30),
  failedRequests: failedRequests.slice(0, 30),
  issues
}
console.log(JSON.stringify(summary, null, 2))
const totalErrors = consoleErrors.length + pageErrors.length
console.log(
  `\n=== 汇总: ${steps.length} 步操作, 控制台错误 ${consoleErrors.length}, 页面异常 ${pageErrors.length}, 失败请求 ${failedRequests.length} ===`
)
process.exit(totalErrors + failedRequests.length > 0 ? 1 : 0)
