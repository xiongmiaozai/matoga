/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 第三方依赖下载与许可确认文案。
 *
 * 首次启动缺 Go 后端二进制、用户选择「自动安装」时，主进程会弹出此协议，
 * 用户勾选同意后才从 GitHub Release 下载官方预编译二进制。这里汇总了下载动作
 * 涉及的第三方开源依赖及其许可证，供用户知情同意（本仓库本身为 MIT 许可）。
 */

// 弹窗里展示的协议正文。
const THIRD_PARTY_NOTICE = `matoga 后端为 Go 编写的本地服务，以下开源依赖会随官方预编译二进制一起发布或在其构建过程中使用。

下载并运行该二进制，表示你已阅读并接受下列开源许可证条款：

· Go 标准库 — BSD 3-Clause License（https://golang.org/LICENSE）
· github.com/go-chi/chi/v5 — MIT License
· github.com/bbrks/go-blurhash — MIT License
· github.com/mdouchement/hdr — MIT License
· github.com/mrjoshuak/go-openexr — BSD 3-Clause License
· github.com/mrjoshuak/go-jpeg2000 — BSD 3-Clause License
· github.com/klauspost/compress — BSD 3-Clause License
· github.com/lucasb-eyer/go-colorful — MIT License

以上依赖的完整许可文本随二进制源码仓库（backend/go.mod 声明）提供。
matoga 自身采用 MIT License，版权归 芝世 (xiongmiaozai) 所有，
来源：https://github.com/xiongmiaozai/matoga`

// 下载地址披露段。所有加速节点都只是对官方 GitHub Release 地址的转发，
// 返回的是同一个官方预编译二进制，内容与官方地址完全一致。
function buildAddressNotice(urls) {
  const list = (urls || []).map((u, i) => `${i + 1}. ${u}`).join('\n')
  return `

━━━ 下载地址说明 ━━━

自动安装会访问下列地址下载 matoga 后端二进制（按实测速度从快到慢依次尝试，
某个地址失败会自动回退到下一个，最后回退到 GitHub 官方地址）：

${list || '（未获取到下载地址）'}

其中除 GitHub 官方地址外的条目均为第三方 GitHub 加速代理，它们只是对官方
Release 地址的转发，返回的二进制与官方地址完全相同，不会改写内容。所有下载
均使用 HTTPS，文件写入本机用户数据目录，不修改系统目录。`
}

// 完整协议正文（含真实下载地址清单）。
function buildNotice(urls) {
  return THIRD_PARTY_NOTICE + buildAddressNotice(urls)
}

// 勾选框旁边的短句。
const AGREEMENT_LABEL = '我已阅读并同意上述第三方依赖的下载与开源许可条款'

module.exports = { THIRD_PARTY_NOTICE, AGREEMENT_LABEL, buildAddressNotice, buildNotice }
