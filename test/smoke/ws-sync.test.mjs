import { WebSocket } from 'ws'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5273'
const wsUrl = base.replace(/^http/, 'ws') + '/ws'
const TMP = path.join(os.tmpdir(), 'matoga-ws-test-' + process.pid)

let pass = 0, fail = 0
function ok(n) { pass++; console.log('  PASS', n) }
function no(n, msg) { fail++; console.log('  FAIL', n, msg || '') }

async function setupData() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, 'src'), { recursive: true })
  fs.mkdirSync(path.join(TMP, 'dest'), { recursive: true })
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(TMP, 'src', `tex${i}.png`), `pixel-data-${i}`)
}

async function apiCall(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  return r.json()
}

async function testBatchProgress() {
  await setupData()
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'src'), recursive: false })
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'dest'), recursive: false })

  const pairs = []
  for (let i = 0; i < 5; i++) {
    pairs.push({
      src: path.join(TMP, 'src', `tex${i}.png`),
      dest: path.join(TMP, 'dest', `tex${i}.png`),
      backup: null,
      name: `tex${i}.png`
    })
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const events = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'test1', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      events.push(msg)
      if (msg.type === 'done') {
        ws.close()
        const progressEvents = events.filter(e => e.type === 'progress')
        if (progressEvents.length === 5) ok('batch progress: 5 progress events')
        else no('batch progress', `expected 5 progress, got ${progressEvents.length}`)

        const last = progressEvents[progressEvents.length - 1]
        if (last.current === 5 && last.total === 5) ok('batch progress: current/total correct')
        else no('batch progress', `current=${last.current} total=${last.total}`)

        if (msg.ok === 5 && msg.fail === 0) ok('batch done: 5 ok 0 fail')
        else no('batch done', `ok=${msg.ok} fail=${msg.fail}`)

        const allHaveName = progressEvents.every(e => typeof e.name === 'string' && e.name.length > 0)
        if (allHaveName) ok('batch progress: all have name')
        else no('batch progress: missing name')

        const allHaveDest = progressEvents.every(e => typeof e.dest === 'string')
        if (allHaveDest) ok('batch progress: all have dest')
        else no('batch progress: missing dest')

        const copied = fs.readdirSync(path.join(TMP, 'dest')).filter(f => f.endsWith('.png'))
        if (copied.length === 5) ok('batch files: 5 files copied to dest')
        else no('batch files', `expected 5, got ${copied.length}`)

        resolve()
      }
    })
    ws.on('error', (e) => { no('batch ws error', e.message); resolve() })
  })
}

async function testCancel() {
  await setupData()
  fs.mkdirSync(path.join(TMP, 'dest2'), { recursive: true })
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'src'), recursive: false })
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'dest2'), recursive: false })

  const pairs = []
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(TMP, 'src', `big${i}.dat`), Buffer.alloc(500000))
    pairs.push({
      src: path.join(TMP, 'src', `big${i}.dat`),
      dest: path.join(TMP, 'dest2', `big${i}.dat`),
      backup: null,
      name: `big${i}.dat`
    })
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    let cancelled = false
    let progressCount = 0
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'test2', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      if (msg.type === 'progress') {
        progressCount++
        if (progressCount === 3 && !cancelled) {
          cancelled = true
          ws.send(JSON.stringify({ type: 'cancel', jobId: 'test2' }))
        }
      }
      if (msg.type === 'done') {
        ws.close()
        if (msg.cancelled) ok('cancel: done event has cancelled=true')
        else no('cancel', 'done.cancelled not true')

        if (msg.ok < 50) ok('cancel: partial copy (' + msg.ok + '/50)')
        else no('cancel', 'all 50 copied despite cancel')

        resolve()
      }
    })
    ws.on('error', (e) => { no('cancel ws error', e.message); resolve() })
  })
}

async function testBackupInBatch() {
  await setupData()
  fs.mkdirSync(path.join(TMP, 'dest3'), { recursive: true })
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(TMP, 'dest3', `tex${i}.png`), 'old-data')
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'src'), recursive: false })
  await apiCall('POST', '/api/compare/scan', { path: path.join(TMP, 'dest3'), recursive: false })

  const pairs = []
  for (let i = 0; i < 3; i++) {
    pairs.push({
      src: path.join(TMP, 'src', `tex${i}.png`),
      dest: path.join(TMP, 'dest3', `tex${i}.png`),
      backup: path.join(TMP, 'dest3', `tex${i}.png`),
      name: `tex${i}.png`
    })
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const events = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'test3', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      events.push(msg)
      if (msg.type === 'done') {
        ws.close()
        const okEvents = events.filter(e => e.type === 'progress' && e.status === 'ok')
        const withBackup = okEvents.filter(e => e.backupPath)
        if (withBackup.length === 3) ok('backup: 3 events have backupPath')
        else no('backup', `expected 3 with backupPath, got ${withBackup.length}`)

        const backups = fs.readdirSync(path.join(TMP, 'dest3')).filter(f => f.includes('_backup_'))
        if (backups.length === 3) ok('backup: 3 backup files created')
        else no('backup', `expected 3 backup files, got ${backups.length}`)

        resolve()
      }
    })
    ws.on('error', (e) => { no('backup ws error', e.message); resolve() })
  })
}

console.log('WebSocket 集成测试\n')
await testBatchProgress()
console.log()
await testCancel()
console.log()
await testBackupInBatch()

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nWS 集成测试结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)