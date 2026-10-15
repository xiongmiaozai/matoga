import { $, showToast } from './core.js'

let themeChangeCallbacks = []

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.body.setAttribute('data-theme', theme)
  const toggle = $('themeToggle')
  if (toggle) toggle.textContent = theme === 'dark' ? '☀️' : '🌙'
  const chk = $('settingThemeChk')
  if (chk) chk.checked = theme === 'dark'
  window.api.setConfig({ theme })
  themeChangeCallbacks.forEach(cb => cb(theme))
}

export function onThemeChange(cb) { themeChangeCallbacks.push(cb) }

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme')
  applyTheme(current === 'dark' ? 'light' : 'dark')
}

export function initSettings() {
  const drawer = $('settingsDrawer')
  const btn = $('settingsBtn')
  const close = $('settingsClose')
  if (btn) btn.addEventListener('click', () => drawer.classList.add('open'))
  if (close) close.addEventListener('click', () => drawer.classList.remove('open'))

  const chk = $('settingThemeChk')
  if (chk) chk.addEventListener('change', () => applyTheme(chk.checked ? 'dark' : 'light'))

  const toggle = $('themeToggle')
  if (toggle) toggle.addEventListener('click', toggleTheme)

  initPathSettings()
}

function initPathSettings() {
  const items = [
    { inputId: 'hdriPresetPathInput', pickId: 'hdriPresetPickBtn', createId: 'hdriPresetCreateBtn', openId: 'hdriPresetOpenBtn', cfgKey: 'hdriPresetPath' },
    { inputId: 'mcPacksPathInput', pickId: 'mcPacksPickBtn', createId: 'mcPacksCreateBtn', openId: 'mcPacksOpenBtn', cfgKey: 'mcPacksPath' }
  ]
  window.api.getConfig().then(cfg => {
    items.forEach(it => {
      const input = $(it.inputId)
      if (input && cfg[it.cfgKey]) input.value = cfg[it.cfgKey]
    })
  })
  items.forEach(it => {
    const input = $(it.inputId)
    const pickBtn = $(it.pickId)
    const createBtn = $(it.createId)
    const openBtn = $(it.openId)
    if (createBtn) createBtn.addEventListener('click', async () => {
      const v = input && input.value.trim()
      if (!v) { showToast('请先输入要创建的文件夹路径'); return }
      const res = await window.api.createFolder(v)
      if (res && res.success) {
        window.api.setConfig({ [it.cfgKey]: v })
        showToast('已创建文件夹并保存地址')
      } else {
        showToast('创建失败：' + (res && res.error ? res.error : '未知错误'))
      }
    })
    if (pickBtn) pickBtn.addEventListener('click', async () => {
      const p = await window.api.pickFolder()
      if (!p) return
      if (input) input.value = p
      window.api.setConfig({ [it.cfgKey]: p })
      showToast('已保存地址')
    })
    if (input) input.addEventListener('change', () => {
      window.api.setConfig({ [it.cfgKey]: input.value.trim() })
    })
    if (openBtn) openBtn.addEventListener('click', () => {
      const v = input && input.value.trim()
      if (!v) { showToast('请先选择地址'); return }
      window.api.openPath(v)
    })
  })
}