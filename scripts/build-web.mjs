/**
 * matoga - 前端生产构建脚本
 * 使用 esbuild 对 JS（打包+minify+tree-shaking）和 CSS（minify）进行压缩
 * 开发模式不受影响，仅生产部署使用构建产物
 */
import { build, transform } from 'esbuild'
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, extname, basename, relative, dirname } from 'node:path'
import { existsSync } from 'node:fs'

const WEB_DIR = 'web'
const OUT_DIR = 'web/dist'
const EXTERNAL = ['three', 'golden-layout']

const vendorExternalPlugin = {
  name: 'vendor-external',
  setup(build) {
    build.onResolve({ filter: /^\/vendor\// }, args => ({ path: args.path, external: true }))
    build.onResolve({ filter: /^\/api\// }, args => ({ path: args.path, external: true }))
  },
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else yield full
  }
}

async function minifyCssFiles() {
  const cssFiles = []
  for await (const f of walk(WEB_DIR)) {
    if (f.endsWith('.css') && !f.includes('/vendor/') && !f.includes('/dist/')) {
      cssFiles.push(f)
    }
  }
  let totalIn = 0, totalOut = 0
  for (const f of cssFiles) {
    const code = await readFile(f, 'utf8')
    const result = await transform(code, { loader: 'css', minify: true })
    const outPath = join(OUT_DIR, relative(WEB_DIR, f))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, result.code)
    const inSize = Buffer.byteLength(code), outSize = Buffer.byteLength(result.code)
    totalIn += inSize; totalOut += outSize
    console.log(`  CSS ${relative(WEB_DIR, f)}: ${inSize} → ${outSize} (${((1 - outSize/inSize)*100).toFixed(1)}% ↓)`)
  }
  return { totalIn, totalOut }
}

async function bundleJs(entrypoints) {
  const result = await build({
    entryPoints: entrypoints,
    bundle: true,
    minify: true,
    target: 'es2022',
    format: 'esm',
    splitting: true,
    external: EXTERNAL,
    plugins: [vendorExternalPlugin],
    outdir: OUT_DIR,
    write: false,
    metafile: true,
  })

  let totalOut = 0
  for (const out of result.outputFiles) {
    const relPath = relative(OUT_DIR, out.path)
    await mkdir(dirname(out.path), { recursive: true })
    await writeFile(out.path, out.text)
    const size = out.text.length
    totalOut += size
    console.log(`  JS  ${relPath}: ${size} bytes`)
  }
  return totalOut
}

async function minifyStandaloneJs() {
  const jsFiles = []
  for await (const f of walk(join(WEB_DIR, 'api'))) {
    if (f.endsWith('.js')) jsFiles.push(f)
  }
  let totalOut = 0
  for (const f of jsFiles) {
    const code = await readFile(f, 'utf8')
    const result = await transform(code, { loader: 'js', minify: true, target: 'es2022' })
    const outPath = join(OUT_DIR, relative(WEB_DIR, f))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, result.code)
    totalOut += result.code.length
    console.log(`  JS  ${relative(WEB_DIR, f)}: ${code.length} → ${result.code.length}`)
  }
  return totalOut
}

async function copyStatic() {
  const staticExts = ['.html', '.svg', '.png', '.json', '.woff', '.woff2', '.ttf']
  for await (const f of walk(WEB_DIR)) {
    if (f.includes('/dist/') || f.includes('/vendor/')) continue
    const ext = extname(f)
    if (staticExts.includes(ext)) {
      const outPath = join(OUT_DIR, relative(WEB_DIR, f))
      await mkdir(dirname(outPath), { recursive: true })
      const data = await readFile(f)
      await writeFile(outPath, data)
    }
  }
  console.log('  静态资源已复制')
}

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   matoga 前端生产构建 (esbuild)     ║')
  console.log('╚══════════════════════════════════════╝')

  if (existsSync(OUT_DIR)) {
    const { rmSync } = await import('node:fs')
    rmSync(OUT_DIR, { recursive: true, force: true })
  }

  console.log('\n[1/4] 打包 JS 入口（tree-shaking + minify）...')
  const jsSize = await bundleJs([
    join(WEB_DIR, 'renderer.js'),
    join(WEB_DIR, 'src/node-editor-main.js'),
  ])

  console.log('\n[2/4] Minify 独立 JS（api/）...')
  const apiSize = await minifyStandaloneJs()

  console.log('\n[3/4] Minify CSS...')
  const { totalIn: cssIn, totalOut: cssOut } = await minifyCssFiles()

  console.log('\n[4/4] 复制静态资源...')
  await copyStatic()

  console.log('\n═══════════════════════════════════════')
  console.log(`构建完成！产物目录: ${OUT_DIR}/`)
  console.log(`  JS bundle:  ${(jsSize/1024).toFixed(1)} KB`)
  console.log(`  JS api:     ${(apiSize/1024).toFixed(1)} KB`)
  console.log(`  CSS:        ${(cssIn/1024).toFixed(1)} → ${(cssOut/1024).toFixed(1)} KB (${((1-cssOut/cssIn)*100).toFixed(1)}% ↓)`)
  console.log(`  总计:       ${((jsSize+apiSize+cssOut)/1024).toFixed(1)} KB`)
  console.log('═══════════════════════════════════════')
}

main().catch(e => { console.error(e); process.exit(1) })