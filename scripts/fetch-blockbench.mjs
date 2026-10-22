/**
 * matoga - 拉取 Blockbench Web 构建产物（持续更新）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 用法:
 *   node scripts/fetch-blockbench.mjs --out=<目标目录>
 *   npm run bb:fetch
 *
 * 从 Blockbench 官方仓库 gh-pages 分支浅克隆已构建的 Web 产物，
 * 复制到目标目录，并注入 matoga 桥接插件引用。
 * gh-pages 分支即 web.blockbench.net 的部署源，稳定且随官方发布更新。
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => { const i = a.indexOf('='); return i > 0 ? [a.slice(0, i), a.slice(i + 1)] : [a, true] })
)
const OUT = args.out || path.join(process.cwd(), 'data', 'blockbench-web')
const REPO = 'https://github.com/JannisX11/blockbench.git'
const BRANCH = 'gh-pages'
const PLUGIN_INJECT = '<script src="/blockbench/plugins/matoga-bridge.js"></script>'

function log(...m) { console.log('[bb-fetch]', ...m) }
function run(cmd, a, opts) { return execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim() }

async function main() {
  log('目标目录:', OUT)
  const tmp = path.join(os.tmpdir(), 'bb-fetch-' + Date.now().toString(36))
  log('克隆', REPO, '(' + BRANCH + ') →', tmp)
  try {
    run('git', ['clone', '--depth', '1', '--branch', BRANCH, REPO, tmp], { timeout: 240000 })
  } catch (e) {
    throw new Error('git clone 失败（请确认已安装 git 且网络可达）: ' + ((e.stderr && e.stderr.toString()) || e.message))
  }

  let commit = '', commitDate = ''
  try {
    commit = run('git', ['-C', tmp, 'rev-parse', '--short', 'HEAD'])
    commitDate = run('git', ['-C', tmp, 'log', '-1', '--format=%ci'])
  } catch {}
  let bbVersion = ''
  try { bbVersion = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).version } catch {}

  fs.mkdirSync(OUT, { recursive: true })
  for (const e of fs.readdirSync(OUT)) {
    if (e === '.gitkeep') continue
    fs.rmSync(path.join(OUT, e), { recursive: true, force: true })
  }
  for (const e of fs.readdirSync(tmp)) {
    if (e === '.git') continue
    fs.cpSync(path.join(tmp, e), path.join(OUT, e), { recursive: true })
  }

  const idx = path.join(OUT, 'index.html')
  if (fs.existsSync(idx)) {
    let html = fs.readFileSync(idx, 'utf8')
    if (!html.includes('matoga-bridge.js')) {
      if (html.includes('</head>')) html = html.replace('</head>', PLUGIN_INJECT + '</head>')
      else if (html.includes('</body>')) html = html.replace('</body>', PLUGIN_INJECT + '</body>')
      else html = PLUGIN_INJECT + html
      fs.writeFileSync(idx, html, 'utf8')
      log('已注入桥接插件')
    }
  } else {
    log('警告: 产物中未找到 index.html')
  }

  fs.writeFileSync(
    path.join(OUT, '.version.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), commit, commitDate, version: bbVersion, source: REPO + '#' + BRANCH }, null, 2),
    'utf8'
  )
  fs.rmSync(tmp, { recursive: true, force: true })
  log('完成 ✓  版本:', bbVersion || commit, ' 提交:', commit)
}

main().then(() => process.exit(0)).catch(e => { console.error('[bb-fetch] 失败:', e.message); process.exit(1) })