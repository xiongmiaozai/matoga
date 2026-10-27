import { WebSocket } from 'ws'
import { join } from 'node:path'
import { apiCall, makeAssert } from '../lib/client.mjs'
import { tmpRoot, cleanDir, ensureDir, writeFile, listDir } from '../lib/data.mjs'

export async function run(ctx) {
  const { base } = ctx
  const wsUrl = base.replace(/^http/, 'ws') + '/ws'
  const { ok, no, summary } = makeAssert('[ws-backup] ')

  const TMP = tmpRoot('ws-backup')
  await cleanDir(TMP)
  await ensureDir(join(TMP, 'src'))
  await ensureDir(join(TMP, 'dest'))
  for (let i = 0; i < 3; i++) {
    await writeFile(join(TMP, 'src', `tex${i}.png`), `pixel-data-${i}`)
    await writeFile(join(TMP, 'dest', `tex${i}.png`), 'old-data')
  }

  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'src'), recursive: false })
  await apiCall(base, 'POST', '/api/compare/scan', { path: join(TMP, 'dest'), recursive: false })

  const pairs = []
  for (let i = 0; i < 3; i++) {
    pairs.push({
      src: join(TMP, 'src', `tex${i}.png`),
      dest: join(TMP, 'dest', `tex${i}.png`),
      backup: join(TMP, 'dest', `tex${i}.png`),
      name: `tex${i}.png`
    })
  }

  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const events = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'sync', jobId: 'ws-backup', pairs })))
    ws.on('message', (data) => {
      const msg = JSON.parse(data)
      events.push(msg)
      if (msg.type === 'done') {
        ws.close()
        const okEvents = events.filter(e => e.type === 'progress' && e.status === 'ok')
        const withBackup = okEvents.filter(e => e.backupPath)
        if (withBackup.length === 3) ok('3 events have backupPath')
        else no('backupPath', `expected 3, got ${withBackup.length}`)

        resolve()
      }
    })
    ws.on('error', (e) => { no('ws error', e.message); resolve() })
  })

  const backups = (await listDir(join(TMP, 'dest'))).filter(f => f.includes('_backup_'))
  if (backups.length === 3) ok('3 backup files created')
  else no('backup files', `expected 3, got ${backups.length}`)

  await cleanDir(TMP)
  return summary()
}