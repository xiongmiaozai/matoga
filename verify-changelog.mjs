import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const htmlPath = path.join(__dirname, 'website', 'landing.html')
const webDir = path.join(__dirname, 'website')
const html = fs.readFileSync(htmlPath, 'utf8')

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('OK   ' + m) }
const ko = (m) => { fail++; console.error('FAIL ' + m) }

console.log('--- 1. inline <script> node --check ---')
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
let m, idx = 0
const tmpFiles = []
while ((m = scriptRe.exec(html)) !== null) {
  idx++
  const code = m[1].trim()
  if (!code) continue
  const tmp = path.join(__dirname, `.tmp-check-${idx}.mjs`)
  fs.writeFileSync(tmp, code)
  tmpFiles.push(tmp)
  try {
    execSync(`node --check "${tmp}"`, { stdio: 'pipe' })
    ok(`inline script #${idx} (${code.length} chars)`)
  } catch (e) {
    ko(`inline script #${idx}: ${e.stderr ? e.stderr.toString().trim() : e.message}`)
  }
}
tmpFiles.forEach((f) => { try { fs.unlinkSync(f) } catch (e) {} })

console.log('--- 2. static server + resource 200 ---')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/landing.html'
  const fp = path.join(webDir, p)
  if (!fp.startsWith(webDir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' })
  fs.createReadStream(fp).pipe(res)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const fetchOk = async (url) => {
  try {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    return res.status === 200 && buf.byteLength > 0
  } catch (e) { return false }
}

const rootOk = await fetchOk(base + '/landing.html')
rootOk ? ok('GET /landing.html 200') : ko('GET /landing.html')

const refs = new Set()
const reSrc = /<(?:script|img|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi
let r
while ((r = reSrc.exec(html)) !== null) {
  const u = r[1]
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('//')) continue
  if (u.startsWith('data:')) continue
  refs.add(u)
}
for (const ref of refs) {
  const u = base + (ref.startsWith('/') ? ref : '/' + ref)
  ;(await fetchOk(u)) ? ok(`GET ${ref} 200`) : ko(`GET ${ref}`)
}

server.close()
console.log(`\n=== pass=${pass} fail=${fail} ===`)
process.exit(fail ? 1 : 0)