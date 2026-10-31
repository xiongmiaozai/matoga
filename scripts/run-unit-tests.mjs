/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 单元测试运行器。
 *
 * 为什么不直接写 `node --test "test/unit/**\/*.test.js"`：
 * 该 glob 依赖 shell 展开，而 Linux（GitHub Actions 的 ubuntu runner）与
 * Windows 行为不一致 —— 引号包住时 shell 不展开，node 也不展开 `**`，
 * 直接报 `Could not find '/home/runner/.../**\/*.test.js'`，导致 CI 必红。
 *
 * 这里用 recursion 自己枚举，跨平台一致，且能明确限定只跑 test/unit。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve('test/unit')

/** 递归收集 *.test.js。 */
function collect(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) collect(full, out)
    else if (ent.isFile() && ent.name.endsWith('.test.js')) out.push(full)
  }
  return out
}

if (!fs.existsSync(ROOT)) {
  console.error(`测试目录不存在: ${ROOT}`)
  process.exit(1)
}

const files = collect(ROOT).sort()
if (!files.length) {
  console.error('未找到任何 *.test.js')
  process.exit(1)
}

console.log(`运行 ${files.length} 个单测文件\n`)

// 串行执行：并行时多个测试文件会争用真实 data/config.json，
// 报 EPERM rename .tmp（本项目已知的 flaky 模式）。
const args = ['--test', '--test-concurrency=1', '--test-timeout=30000', ...files]

const r = spawnSync(process.execPath, args, { stdio: 'inherit' })
process.exit(r.status ?? 1)
