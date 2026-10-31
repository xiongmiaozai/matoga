/**
 * matoga - HDRI 预设面板：worker
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 hdri-preset.js 按职责搬出，逻辑未改。
 */
import { S } from './state.js'

export function getPreviewWorker() {
  if (S.previewWorker) return S.previewWorker
  S.previewWorker = new Worker(new URL('./hdr-preview-worker.js', import.meta.url), { type: 'module' })
  S.previewWorker.onmessage = e => {
    const cb = S.previewWorkerCallbacks.get(e.data.id)
    if (cb) {
      S.previewWorkerCallbacks.delete(e.data.id)
      cb(e.data)
    }
  }
  return S.previewWorker
}

export function workerParse(buffer, ext) {
  return new Promise(resolve => {
    const id = ++S.previewWorkerSeq
    S.previewWorkerCallbacks.set(id, resolve)
    getPreviewWorker().postMessage({ id, buffer, ext }, [buffer])
  })
}
