const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '../../web/src/panels/preview/panel.html'), 'utf8')

test('preview 面板包含视差高度状态 DOM（回归防护）', () => {
  assert.match(html, /id="m3dHeightStatus"/)
  assert.match(html, /id="m3dParallaxStatusFill"/)
  assert.match(html, /class="m3d-parallax-status"/)
})