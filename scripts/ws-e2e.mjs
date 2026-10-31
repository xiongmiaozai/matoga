/**
 * matoga - WebSocket 进度通道端到端验证
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 用法：先启动 Go 服务，再运行本脚本：
 *   go run ./cmd/matoga -port 5320 -data-root <dir>
 *   WS_E2E_BASE=<dir>/ws-e2e node scripts/ws-e2e.mjs 5320
 *
 * 注意：测试文件必须落在服务的信任根（-data-root）内，否则
 * fsx.GuardWrite 会以 "path outside trusted roots" 拒绝 —— 这是预期的安全行为。
 *
 * 覆盖：
 *  1. 正常 sync → progress 序列 + done(ok=N) + 目标文件落地
 *  2. 空 pairs → done 带 error: 'no pairs'
 *  3. cancel → done(cancelled=true) 且已处理项数 < 总数
 *  4. 坏 JSON → 静默忽略，连接不断，后续消息仍生效
 *  5. 带 backup → 先备份再复制，progress 带 backupPath
 */
import { WebSocket } from 'ws'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = process.argv[2] || '5311'
const URL = `ws://127.0.0.1:${PORT}/api/ws`

// 必须落在信任根内，否则 fsx.GuardRead/GuardWrite 会拒绝（预期安全行为）。
// 优先用环境变量指定的 data-root（与服务启动参数一致）。
const base = process.env.WS_E2E_BASE || path.resolve('data', '.ws-e2e')
fs.mkdirSync(base, { recursive: true })
const tmp = fs.mkdtempSync(path.join(base, 'run-'))

function makePair(n) {
  const src = path.join(tmp, `src${n}.txt`)
  const dest = path.join(tmp, `dst${n}.txt`)
  fs.writeFileSync(src, `content-${n}`)
  return { src, dest, name: `file${n}` }
}

function runCase(name, fn) {
  return new Promise(resolve => {
    const ws = new WebSocket(URL)
    const events = []
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        console.log(`  [${name}] 超时`)
        ws.terminate()
        resolve({ name, events })
      }
    }, 15000)

    ws.on('open', () => fn(ws, events))
    ws.on('message', raw => {
      let m
      try {
        m = JSON.parse(raw)
      } catch {
        return
      }
      events.push(m)
      if (m.type === 'done') {
        done = true
        clearTimeout(timer)
        setTimeout(() => {
          ws.close()
          resolve({ name, events })
        }, 100)
      }
    })
    ws.on('error', e => {
      clearTimeout(timer)
      console.log(`  [${name}] 连接错误: ${e.message}`)
      resolve({ name, events })
    })
  })
}

;(async () => {
  console.log(`  临时目录: ${tmp}\n`)

  // 1. 正常批量复制
  const r1 = await runCase('正常复制', ws => {
    ws.send(JSON.stringify({ type: 'sync', jobId: 'j1', pairs: [makePair(1), makePair(2), makePair(3)] }))
  })
  const prog1 = r1.events.filter(e => e.type === 'progress')
  const done1 = r1.events.find(e => e.type === 'done')
  console.log(`  1) 正常复制: progress=${prog1.length} done.ok=${done1 && done1.ok} done.fail=${done1 && done1.fail}`)
  console.log(
    `     进度序列: ${prog1.map(p => `${p.current}/${p.total}:${p.status}${p.error ? '(' + p.error + ')' : ''}`).join(' → ')}`
  )
  const filesOk = [1, 2, 3].every(n => fs.existsSync(path.join(tmp, `dst${n}.txt`)))
  console.log(`     目标文件全部生成: ${filesOk ? '是 ✓' : '否 ✗'}`)

  // 2. 空 pairs
  const r2 = await runCase('空pairs', ws => {
    ws.send(JSON.stringify({ type: 'sync', jobId: 'j2', pairs: [] }))
  })
  const d2 = r2.events.find(e => e.type === 'done')
  console.log(`  2) 空 pairs: error=${d2 && d2.error}`)

  // 3. 取消：任务必须够慢才能观察到中断。
  //    用 200 个 1MB 文件，并在收到第一条 progress 后立即取消 —— 这样取消
  //    必然落在「项与项之间」，能验证到 cancelled=true 且未处理完所有项。
  const r3 = await runCase('取消', (ws, events) => {
    const pairs = []
    const mb = Buffer.alloc(1024 * 1024, 'x')
    for (let i = 10; i < 210; i++) {
      const src = path.join(tmp, `big${i}.bin`)
      fs.writeFileSync(src, mb)
      pairs.push({ src, dest: path.join(tmp, `bigdst${i}.bin`), name: `big${i}` })
    }
    ws.send(JSON.stringify({ type: 'sync', jobId: 'j3', pairs }))
    // 第一条 progress 到达就取消
    const iv = setInterval(() => {
      if (events.some(e => e.type === 'progress')) {
        clearInterval(iv)
        ws.send(JSON.stringify({ type: 'cancel', jobId: 'j3' }))
      }
    }, 2)
  })
  const d3 = r3.events.find(e => e.type === 'done')
  const p3 = r3.events.filter(e => e.type === 'progress')
  console.log(`  3) 取消: cancelled=${d3 && d3.cancelled} 已处理=${d3 && d3.ok} 共200项`)
  console.log(
    `     取消生效判据: cancelled=true 且 已处理 < 200 → ${d3 && d3.cancelled && d3.ok < 200 ? '通过 ✓' : '未通过'}`
  )

  // 4. 坏 JSON 后仍能正常通信
  const r4 = await runCase('坏JSON', ws => {
    ws.send('这不是 JSON{{{')
    setTimeout(() => ws.send(JSON.stringify({ type: 'sync', jobId: 'j4', pairs: [makePair(99)] })), 100)
  })
  const d4 = r4.events.find(e => e.type === 'done')
  console.log(`  4) 坏JSON后续仍工作: done.ok=${d4 && d4.ok}`)

  // 5. 备份
  const r5 = await runCase('带备份', ws => {
    const p = makePair(50)
    fs.writeFileSync(p.dest, 'old-content')
    p.backup = p.dest
    ws.send(JSON.stringify({ type: 'sync', jobId: 'j5', pairs: [p] }))
  })
  const prog5 = r5.events.filter(e => e.type === 'progress')
  console.log(
    `  5) 带备份: status=${prog5[0] && prog5[0].status} backupPath=${prog5[0] && prog5[0].backupPath ? '有 ✓' : '无'}`
  )

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('\n  测试完成')
})()
