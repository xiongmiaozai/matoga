/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 GitHub Release 下载官方预编译 Go 后端二进制。
 *
 * 仅当 resolveGoBackend() 找不到二进制、且用户在「依赖安装」弹窗里勾选同意
 * 第三方许可后才会调用。下载产物写入 app.getPath('userData')/bin/，不触碰
 * 只读的打包资源目录。
 */

const { app, net } = require('electron')
const fs = require('fs')
const path = require('path')

const RELEASE_OWNER = 'xiongmiaozai'
const RELEASE_REPO = 'matoga'

// 平台 → Release 资产名。与 .github/workflows/release-backend.yml 的 matrix 对应。
function assetNameForPlatform() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  switch (process.platform) {
    case 'win32':
      return 'matoga-backend-windows-x64' + ext
    case 'darwin':
      return 'matoga-backend-macos-' + process.arch + ext
    case 'linux':
      return 'matoga-backend-linux-' + process.arch + ext
    default:
      return null
  }
}

function downloadUrl() {
  const asset = assetNameForPlatform()
  if (!asset) return null
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest/download/${asset}`
}

function targetDir() {
  return path.join(app.getPath('userData'), 'bin')
}

function targetPath() {
  const exe = process.platform === 'win32' ? 'matoga-backend.exe' : 'matoga-backend'
  return path.join(targetDir(), exe)
}

/**
 * 下载二进制到 userData/bin/。
 *
 * @param {(received: number, total: number | null) => void} onProgress 进度回调
 * @returns {Promise<string>} 落盘后的可执行文件绝对路径
 */
function downloadBackend(onProgress) {
  return new Promise((resolve, reject) => {
    const url = downloadUrl()
    if (!url) {
      reject(new Error('当前平台不支持自动安装后端'))
      return
    }
    const request = net.request(url)
    let total = null
    let received = 0

    request.on('response', response => {
      const status = response.statusCode
      if (status !== 200) {
        reject(new Error(`下载失败：HTTP ${status}`))
        response.resume()
        return
      }
      const len = Number(response.headers['content-length'])
      if (Number.isFinite(len) && len > 0) total = len

      fs.mkdirSync(targetDir(), { recursive: true })
      const tmp = targetPath() + '.download'
      const out = fs.createWriteStream(tmp)

      response.on('data', chunk => {
        received += chunk.length
        if (onProgress) onProgress(received, total)
      })
      response.on('error', err => {
        out.destroy()
        try {
          fs.unlinkSync(tmp)
        } catch {}
        reject(err)
      })
      response.on('end', () => {
        out.end(() => {
          try {
            fs.renameSync(tmp, targetPath())
            if (process.platform !== 'win32') {
              try {
                fs.chmodSync(targetPath(), 0o755)
              } catch {}
            }
            resolve(targetPath())
          } catch (err) {
            reject(err)
          }
        })
      })
      response.pipe(out)
    })

    request.on('error', err => reject(err))
    request.end()
  })
}

module.exports = { downloadBackend, targetPath, assetNameForPlatform, downloadUrl }
