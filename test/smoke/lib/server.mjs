/**
 * 冒烟测试服务器启停辅助：复用 MATOGA_SPAWNED stdout 信号实现零轮询就绪检测。
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.js')

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export async function startServer({ dataRoot, presetRoot = ROOT, port } = {}) {
  const actualPort = port ?? (await freePort())
  const env = {
    ...process.env,
    MATOGA_SPAWNED: '1',
    ...(dataRoot ? { MATOGA_DATA_ROOT: dataRoot } : {}),
    ...(presetRoot ? { MATOGA_PRESET_ROOT: presetRoot } : {})
  }
  const child = spawn(process.execPath, [SERVER_ENTRY, '--port', String(actualPort)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const base = await waitForListening(child)
  return { child, base, port: actualPort }
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup()
      reject(new Error('服务器启动超时 (10s)'))
    }, 10000)

    let buf = ''
    const onData = (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/MATOGA_LISTENING:(\d+)/)
      if (m) {
        cleanup()
        resolve(`http://127.0.0.1:${m[1]}`)
      }
    }
    const onStderr = (d) => process.stderr.write('[server] ' + d)
    const onExit = (code) => {
      cleanup()
      reject(new Error(`服务器进程提前退出 (code=${code})`))
    }

    function cleanup() {
      clearTimeout(deadline)
      child.stdout.removeListener('data', onData)
      child.stderr.removeListener('data', onStderr)
      child.removeListener('exit', onExit)
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
  })
}

export async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((r) => {
    child.once('exit', r)
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; r() }, 5000)
  })
}

export async function cleanDataRoot(root) {
  if (!root) return
  try { await fs.rm(root, { recursive: true, force: true }) } catch {}
}