/**
 * 冒烟测试 HTTP / WebSocket 客户端辅助与断言。
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

export async function call(base, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() }
  return { status: res.status, text: await res.text() }
}

export async function apiCall(base, method, p, body) {
  return (await call(base, method, p, body)).json
}

export function makeAssert(prefix = '') {
  let pass = 0
  let fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  PASS  ${prefix}${name}`) }
    else { fail++; console.log(`  FAIL  ${prefix}${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`) }
  }
  const ok = (name) => { pass++; console.log(`  PASS  ${prefix}${name}`) }
  const no = (name, msg) => { fail++; console.log(`  FAIL  ${prefix}${name}${msg ? ' ' + msg : ''}`) }
  const summary = () => ({ pass, fail })
  return { check, ok, no, summary }
}