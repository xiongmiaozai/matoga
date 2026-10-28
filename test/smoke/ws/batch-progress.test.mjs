import { WebSocket } from 'ws'
import { join } from 'node:path'
import { apiCall, makeAssert } from '../lib/client.mjs'
import { tmpRoot, cleanDir, ensureDir, writeFile, listDir } from '../lib/data.mjs'

export async function run(ctx) {
  const { base } = ctx
  const wsUrl = base.replace(/^http/, 'ws') + '/ws'
  const { ok, no, summary } = makeAssert('[ws-batch] ')

  const TMP = tmpRoot('ws-batch')
  await cleanDir(TMP)
  await ensureDir(join(TMP, 'src'))
  await ensureDir(join(TMP, 'dest'))
  for (let i = 0; i < 5; i++) {
    await writeFile(join(TMP, 'src', `tex${i}.png`), `pixel-data-${i}`)
  }

  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'src'), recursive: false })
  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'dest'), recursive: false })

  const pairs = []
  for (let i = 0; i < 5; i++) {
    pairs.push({
      src: join(TMP, 'src', `tex${i}.png`),
      dest: join(TMP, 'dest', `tex${i}.png`),
      backup: null,
      name: `tex${i}.png`
    })
  }

  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const events = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'batch-progress', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      events.push(msg)
      if (msg.type === 'done') {
        ws.close()
        const progressEvents = events.filter(e => e.type === 'progress')
        if (progressEvents.length === 5) ok('5 progress events')
        else no('progress count', `expected 5, got ${progressEvents.length}`)

        const last = progressEvents[progressEvents.length - 1]
        if (last.current === 5 && last.total === 5) ok('current/total correct')
        else no('current/total', `current=${last.current} total=${last.total}`)

        if (msg.ok === 5 && msg.fail === 0) ok('done: 5 ok 0 fail')
        else no('done', `ok=${msg.ok} fail=${msg.fail}`)

        if (progressEvents.every(e => typeof e.name === 'string' && e.name.length > 0)) ok('all have name')
        else no('missing name')

        if (progressEvents.every(e => typeof e.dest === 'string')) ok('all have dest')
        else no('missing dest')

        resolve()
      }
    })
    ws.on('error', (e) => { no('ws error', e.message); resolve() })
  })

  const copied = (await listDir(join(TMP, 'dest'))).filter(f => f.endsWith('.png'))
  if (copied.length === 5) ok('5 files copied to dest')
  else no('files copied', `expected 5, got ${copied.length}`)

  await cleanDir(TMP)
  return summary()
}