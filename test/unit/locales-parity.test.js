// 语言包拆分后的一致性守卫：
// 1. zh / en 的键集合必须完全相同（缺一个键就会出现回退到 key 的界面文本）
// 2. 键总数不得少于拆分前的 731（防止拆分时漏搬词条）
//
// 这两个断言在拆分前不存在，属于拆分引入风险的兜底。

import test from 'node:test'
import assert from 'node:assert/strict'

import zh from '../../web/src/locales/zh.js'
import en from '../../web/src/locales/en.js'

const SPLIT_BASELINE = 731

test('zh / en 键集合完全一致', () => {
  const zk = Object.keys(zh).sort()
  const ek = Object.keys(en).sort()
  const onlyZh = zk.filter((k) => !(k in en))
  const onlyEn = ek.filter((k) => !(k in zh))
  assert.deepEqual(onlyZh, [], `仅 zh 有的键: ${onlyZh.slice(0, 5).join(', ')}`)
  assert.deepEqual(onlyEn, [], `仅 en 有的键: ${onlyEn.slice(0, 5).join(', ')}`)
  assert.equal(zk.length, ek.length)
})

test('键总数不少于拆分前的基线', () => {
  assert.ok(
    Object.keys(zh).length >= SPLIT_BASELINE,
    `zh 键数 ${Object.keys(zh).length} 少于基线 ${SPLIT_BASELINE}`,
  )
  assert.ok(
    Object.keys(en).length >= SPLIT_BASELINE,
    `en 键数 ${Object.keys(en).length} 少于基线 ${SPLIT_BASELINE}`,
  )
})

test('所有键的值都是非空字符串', () => {
  for (const [loc, dict] of [['zh', zh], ['en', en]]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${loc} 的 ${k} 不是字符串`)
      assert.ok(v.length > 0, `${loc} 的 ${k} 为空字符串`)
    }
  }
})

test('语言切换用的 lang.* 词条存在', () => {
  assert.ok(zh['lang.zh'])
  assert.ok(zh['lang.en'])
  assert.ok(en['lang.zh'])
  assert.ok(en['lang.en'])
})
