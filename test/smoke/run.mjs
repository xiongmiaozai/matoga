/**
 * matoga - 冒烟测试统一 runner
 * 同进程启动隔离服务器，并行调度 API 组与 WS 组，结束后回收。
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { join } from 'node:path'
import { startServer, stopServer, cleanDataRoot } from './lib/server.mjs'
import { tmpRoot, cleanDir, ensureDir, writeFile } from './lib/data.mjs'

import * as apiScan from './api/scan.test.mjs'
import * as apiFileOps from './api/file-ops.test.mjs'
import * as apiConfig from './api/config.test.mjs'
import * as apiUpload from './api/upload.test.mjs'
import * as apiMisc from './api/misc.test.mjs'

import * as wsBatchProgress from './ws/batch-progress.test.mjs'
import * as wsCancel from './ws/cancel.test.mjs'
import * as wsBackup from './ws/backup.test.mjs'

const API_MODULES = [apiScan, apiFileOps, apiConfig, apiUpload, apiMisc]
const WS_MODULES = [wsBatchProgress, wsCancel, wsBackup]

async function runGroup(label, modules, ctx) {
  console.log(`${label}\n`)
  let pass = 0
  let fail = 0
  for (const mod of modules) {
    try {
      const r = await mod.run(ctx)
      pass += r.pass
      fail += r.fail
    } catch (e) {
      fail++
      console.error(`  ERROR  ${label.slice(0, -1)} 模块异常: ${e.message}`)
    }
  }
  console.log(`\n${label}结果: ${pass} 通过, ${fail} 失败\n`)
  return { pass, fail }
}

async function ensureApiSmokeData(smoke) {
  await cleanDir(smoke)
  await ensureDir(join(smoke, 'sub'))
  await writeFile(join(smoke, 'a.png'), 'hello-matoga-png-fake')
  await writeFile(join(smoke, 'b.txt'), 'hello-b')
  await writeFile(join(smoke, 'c.png'), 'fake-c')
  await writeFile(join(smoke, 'd.png'), 'fake-d')
}

let server = null
let dataRoot = null
let failed = true
try {
  dataRoot = tmpRoot('data')
  await cleanDataRoot(dataRoot)
  const { child, base } = await startServer({ dataRoot })
  server = child
  console.log(`冒烟服务器已就绪: ${base} (pid ${server.pid})\n`)

  const smoke = tmpRoot('api')
  await ensureApiSmokeData(smoke)
  const ctx = { base, smoke }

  const [apiResult, wsResult] = await Promise.all([
    runGroup('API 冒烟', API_MODULES, ctx),
    runGroup('WS 集成', WS_MODULES, { base })
  ])

  const totalPass = apiResult.pass + wsResult.pass
  const totalFail = apiResult.fail + wsResult.fail
  console.log(`冒烟总结果: ${totalPass} 通过, ${totalFail} 失败`)
  failed = totalFail > 0

  await cleanDir(smoke)
} catch (e) {
  console.error('冒烟运行失败:', e.message)
  failed = true
} finally {
  await stopServer(server)
  await cleanDataRoot(dataRoot)
}
process.exit(failed ? 1 : 0)