/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 批量复制执行器：串行执行 backup→copy，支持取消，逐项发进度。
 */

const fileService = require('./file-service')
const { guardRead, guardWrite } = require('../middleware/validate')
const { logger } = require('../middleware/logger')

const jobs = new Map()

function execute(pairs, jobId, emit) {
  const controller = { cancelled: false }
  const job = { ok: 0, fail: 0, current: 0, total: pairs.length, cancelled: false }
  jobs.set(jobId, controller)

  ;(async () => {
    for (const p of pairs) {
      if (controller.cancelled) { job.cancelled = true; break }
      job.current++
      let bkPath = null
      try {
        if (p.backup) {
          const bp = guardWrite(p.backup)
          const bk = await fileService.backupFile(bp)
          if (!bk.success) { job.fail++; emit(progress(jobId, job, p.name, 'backup_fail')); continue }
          bkPath = bk.backupPath
        }
        const s = guardRead(p.src)
        const d = guardWrite(p.dest)
        const r = await fileService.copyFile(s, d)
        if (r.success) { job.ok++; fileService.invalidateHash(d); emit(progress(jobId, job, p.name, 'ok', bkPath, p.dest)) }
        else { job.fail++; emit(progress(jobId, job, p.name, 'copy_fail', null, p.dest)) }
      } catch (e) {
        job.fail++
        emit(progress(jobId, job, p.name, 'error', null, e.code || e.message))
      }
    }
    emit({ type: 'done', jobId, ok: job.ok, fail: job.fail, cancelled: job.cancelled })
    jobs.delete(jobId)
  })().catch((e) => {
    logger.error('sync', `job ${jobId} crashed: ${e.message}`)
    emit({ type: 'done', jobId, ok: job.ok, fail: job.fail, cancelled: false, error: e.message })
    jobs.delete(jobId)
  })
}

function progress(jobId, job, name, status, backupPath, dest, error) {
  return { type: 'progress', jobId, current: job.current, total: job.total, ok: job.ok, fail: job.fail, name, status, backupPath, dest, error }
}

function cancel(jobId) {
  const c = jobs.get(jobId)
  if (c) { c.cancelled = true; return true }
  return false
}

module.exports = { execute, cancel, jobs }