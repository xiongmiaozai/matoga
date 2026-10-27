import { WebSocket } from 'ws'
import { join } from 'node:path'
import { apiCall, makeAssert } from '../lib/client.mjs'
import { tmpRoot, cleanDir, ensureDir, writeFile } from '../lib/data.mjs'

const FILE_COUNT = 50
const FILE_SIZE = 10000

export async function run(ctx) {
  const { base } = ctx
  const wsUrl = base.replace(/^http/, 'ws') + '/ws'
  const { ok, no, summary } = makeAssert('[ws-cancel] ')

  const TMP = tmpRoot('ws-cancel')
  await cleanDir(TMP)
  await ensureDir(join(TMP, 'src'))
  await ensureDir(join(TMP, 'dest'))
  for (let i = 0; i < FILE_COUNT; i++) {
    await writeFile(join(TMP, 'src', `big${i}.dat`), Buffer.allocUnsafe(FILE_SIZE))
  }

  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'src'), recursive: false })
  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'dest'), recursive: false })

  const pairs = []
  for (let i = 0; i < FILE_COUNT; i++) {
    pairs.push({
      src: join(TMP, 'src', `big${i}.dat`),
      dest: join(TMP, 'dest', `big${i}.dat`),
      backup: null,
      name: `big${i}.dat`
    })
  }

  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    let cancelled = false
    let progressCount = 0
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'ws-cancel', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      if (msg.type === 'progress') {
        progressCount++
        if (progressCount === 3 && !cancelled) {
          cancelled = true
          ws.send(JSON.stringify({ type: 'cancel', jobId: 'ws-cancel' }))
        }
      }
      if (msg.type === 'done') {
        ws.close()
        if (msg.cancelled) ok('done event has cancelled=true')
        else no('cancelled', 'done.cancelled not true')

        if (msg.ok < FILE_COUNT) ok(`partial copy (${msg.ok}/${FILE_COUNT})`)
        else no('partial', 'all copied despite cancel')

        resolve()
      }
    })
    ws.on('error', (e) => { no('ws error', e.message); resolve() })
  })

  await cleanDir(TMP)
  return summary()
}