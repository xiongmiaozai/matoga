/**
 * matoga - Blockbench 集成服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 自托管 Blockbench Web 构建产物 + 模型/材质收件箱管理。
 * 产物落盘于 DATA_ROOT/data/blockbench-web（可写，跨开发/打包模式）。
 */

const fs = require('fs')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const { DATA_ROOT } = require('../paths')

const BB_WEB_DIR = path.join(DATA_ROOT, 'data', 'blockbench-web')
const BB_MODELS_DIR = path.join(DATA_ROOT, 'data', 'blockbench-models')
const BB_INBOX_DIR = path.join(DATA_ROOT, 'data', 'blockbench-inbox')

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }) }

function getStatus() {
  let indexExists = false
  try { indexExists = fs.existsSync(path.join(BB_WEB_DIR, 'index.html')) } catch {}
  let version = null
  try { version = JSON.parse(fs.readFileSync(path.join(BB_WEB_DIR, '.version.json'), 'utf8')) } catch {}
  return { installed: indexExists, version, webDir: BB_WEB_DIR, modelsDir: BB_MODELS_DIR, inboxDir: BB_INBOX_DIR }
}

function fetchLatest() {
  const os = require('os')
  const REPO = 'https://github.com/JannisX11/blockbench.git'
  const BRANCH = 'gh-pages'
  const PLUGIN_INJECT = '<script src="/blockbench/plugins/matoga-bridge.js"></script>'
  const EXCLUDE = new Set(['.git', '.github', '.vscode', 'node_modules', 'content', 'scripts', 'electron', 'build.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'typedoc.json', '.travis.yml', '.gitignore', '.gitattributes', 'CNAME', 'LICENSE.MD', 'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.MD'])
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), 'bb-fetch-' + Date.now().toString(36))
    execFile('git', ['clone', '--depth', '1', '--branch', BRANCH, REPO, tmp], { timeout: 240000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error('git clone 失败（请确认已安装 git 且网络可达）: ' + ((stderr && stderr.toString()) || err.message)))
      try {
        execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: tmp, stdio: 'pipe', timeout: 300000 })
        execFileSync('npm', ['run', 'build-web'], { cwd: tmp, stdio: 'pipe', timeout: 200000 })
        let commit = '', commitDate = ''
        try { commit = execFileSync('git', ['-C', tmp, 'rev-parse', '--short', 'HEAD']).toString().trim(); commitDate = execFileSync('git', ['-C', tmp, 'log', '-1', '--format=%ci']).toString().trim() } catch {}
        let bbVersion = ''
        try { bbVersion = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')).version } catch {}
        fs.mkdirSync(BB_WEB_DIR, { recursive: true })
        for (const e of fs.readdirSync(BB_WEB_DIR)) { if (e === '.gitkeep') continue; fs.rmSync(path.join(BB_WEB_DIR, e), { recursive: true, force: true }) }
        for (const e of fs.readdirSync(tmp)) { if (EXCLUDE.has(e)) continue; fs.cpSync(path.join(tmp, e), path.join(BB_WEB_DIR, e), { recursive: true }) }
        const idx = path.join(BB_WEB_DIR, 'index.html')
        let injected = false
        if (fs.existsSync(idx)) {
          let html = fs.readFileSync(idx, 'utf8')
          if (!html.includes('matoga-bridge.js')) {
            if (html.includes('</head>')) html = html.replace('</head>', PLUGIN_INJECT + '</head>')
            else if (html.includes('</body>')) html = html.replace('</body>', PLUGIN_INJECT + '</body>')
            else html = PLUGIN_INJECT + html
            fs.writeFileSync(idx, html, 'utf8'); injected = true
          }
        }
        fs.writeFileSync(path.join(BB_WEB_DIR, '.version.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), commit, commitDate, version: bbVersion, source: REPO + '#' + BRANCH + ' (built locally)' }, null, 2), 'utf8')
        fs.rmSync(tmp, { recursive: true, force: true })
        resolve({ version: bbVersion || commit, commit, injected })
      } catch (e) {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
        reject(e)
      }
    })
  })
}

async function listModels() {
  await ensureDir(BB_MODELS_DIR)
  const files = await fs.promises.readdir(BB_MODELS_DIR)
  const out = []
  for (const f of files) {
    if (!f.endsWith('.bbmodel')) continue
    const p = path.join(BB_MODELS_DIR, f)
    const st = await fs.promises.stat(p)
    let meta = {}
    try {
      const j = JSON.parse(await fs.promises.readFile(p, 'utf8'))
      meta = { name: j.name, format: j.meta && j.meta.format, model_format: j.meta && j.meta.model_format }
    } catch {}
    out.push({ id: f.replace(/\.bbmodel$/, ''), file: f, size: st.size, mtime: st.mtimeMs, ...meta })
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function saveModel({ id, name, data }) {
  await ensureDir(BB_MODELS_DIR)
  const safeName = String(name || 'model').replace(/[^\w.\-]+/g, '_')
  const fid = id || (safeName + '-' + Date.now().toString(36))
  const p = path.join(BB_MODELS_DIR, fid + '.bbmodel')
  const content = typeof data === 'string' ? data : JSON.stringify(data)
  await fs.promises.writeFile(p, content, 'utf8')
  return { id: fid, path: p, size: content.length }
}

async function loadModel(id) {
  const p = path.join(BB_MODELS_DIR, id + '.bbmodel')
  const raw = await fs.promises.readFile(p, 'utf8')
  let json = null
  try { json = JSON.parse(raw) } catch {}
  return { id, raw, json }
}

async function deleteModel(id) {
  await fs.promises.unlink(path.join(BB_MODELS_DIR, id + '.bbmodel'))
  return { id }
}

async function listInbox() {
  await ensureDir(BB_INBOX_DIR)
  const files = await fs.promises.readdir(BB_INBOX_DIR)
  const out = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try { out.push(JSON.parse(await fs.promises.readFile(path.join(BB_INBOX_DIR, f), 'utf8'))) } catch {}
  }
  out.sort((a, b) => (a.at || 0) - (b.at || 0))
  return out
}

async function pushToInbox({ name, dataUrl, meta }) {
  await ensureDir(BB_INBOX_DIR)
  const fid = String(name || 'texture').replace(/[^\w.\-]+/g, '_') + '-' + Date.now().toString(36)
  const p = path.join(BB_INBOX_DIR, fid + '.json')
  await fs.promises.writeFile(p, JSON.stringify({ id: fid, name, dataUrl, meta, at: Date.now() }, null, 2), 'utf8')
  return { id: fid, path: p }
}

async function clearInboxItem(id) {
  await fs.promises.unlink(path.join(BB_INBOX_DIR, id + '.json'))
  return { id }
}

module.exports = {
  BB_WEB_DIR, BB_MODELS_DIR, BB_INBOX_DIR,
  getStatus, fetchLatest,
  listModels, saveModel, loadModel, deleteModel,
  listInbox, pushToInbox, clearInboxItem,
}