/**
 * matoga - 冒烟测试统一 runner
 * 自启隔离服务器实例（独立端口 + 独立数据目录），依次执行 api-smoke 与 ws-sync，结束后回收。
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const TMP_DATA = path.join(os.tmpdir(), 'matoga-smoke-data-' + process.pid)

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function waitServer(child, port) {
  const deadline = Date.now() + 20000
  return new Promise((resolve, reject) => {
    let actualPort = port
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        cleanup()
        reject(new Error('服务器启动超时'))
        return
      }
      try {
        const r = await fetch(`http://127.0.0.1:${actualPort}/api/health`)
        const j = await r.json()
        if (j.ok && j.data.status === 'ok') {
          if (j.data.pid !== child.pid) {
            cleanup()
            reject(new Error(`health pid 不匹配: 期望 ${child.pid}，实际 ${j.data.pid}`))
            return
          }
          cleanup()
          resolve(`http://127.0.0.1:${actualPort}`)
        }
      } catch { /* 尚未就绪，继续轮询 */ }
    }, 250)

    let buf = ''
    const onData = (d) => {
      buf += d.toString()
      const m = buf.match(/http:\/\/localhost:(\d+)\//)
      if (m) actualPort = parseInt(m[1], 10)
    }
    const onStderr = (d) => process.stderr.write('[server] ' + d)
    const onExit = () => {
      cleanup()
      reject(new Error('服务器进程提前退出'))
    }

    function cleanup() {
      clearInterval(timer)
      child.stdout.removeListener('data', onData)
      child.stderr.removeListener('data', onStderr)
      child.removeListener('exit', onExit)
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
  })
}

function runTest(file, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, file)], {
      env: { ...process.env, ...env },
      stdio: 'inherit'
    })
    p.on('exit', (code) => resolve(code ?? 1))
  })
}

let server = null
let failed = false
try {
  fs.rmSync(TMP_DATA, { recursive: true, force: true })
  fs.mkdirSync(TMP_DATA, { recursive: true })
  const port = await freePort()
  const env = {
    MATOGA_DATA_ROOT: TMP_DATA,
    MATOGA_PRESET_ROOT: ROOT
  }
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--port', String(port)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const base = await waitServer(server, port)
  env.SMOKE_BASE = base
  console.log(`冒烟服务器已就绪: ${base} (pid ${server.pid})\n`)

  const c1 = await runTest('api-smoke.mjs', env)
  console.log()
  const c2 = await runTest('ws-sync.test.mjs', env)
  failed = !!(c1 || c2)
} catch (e) {
  console.error('冒烟运行失败:', e.message)
  failed = true
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise((r) => {
      server.once('exit', r)
      setTimeout(() => { try { server.kill('SIGKILL') } catch {} ; r() }, 5000)
    })
  }
  fs.rmSync(TMP_DATA, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)