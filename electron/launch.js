/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Electron 启动器：清除 ELECTRON_RUN_AS_NODE（IDE 终端常设此变量，
 * 会导致 electron.exe 以纯 node 模式运行而无法获取 Electron API），
 * 然后 spawn 真正的 Electron 进程。
 */

const { spawn } = require('child_process')
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = ['.'].concat(process.argv.slice(2))
const child = spawn(electronPath, args, { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code || 0))