/**
 * matoga - 目录树选择器：界面文案与取词
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。按 document.documentElement.lang 在 zh/en 间切换。
 */

const UI = {
  zh: { title: '选择文件夹', inputPh: '输入绝对路径后回车', up: '上级', home: '主目录', select: '选择当前目录', cancel: '取消', empty: '（空目录）', loadErr: '读取失败',
        fav: '收藏', recent: '最近', filterPh: '过滤当前列表', searchPh: '递归搜索子目录', newFolder: '新建', addFav: '加入收藏', searching: '搜索中…', noResults: '无匹配结果', searchResults: '搜索结果', clear: '清除', newPh: '新文件夹名', createErr: '创建失败', root: '位置', copyPath: '复制路径', pastePath: '粘贴路径', copiedPath: '已复制路径', pasteEmpty: '剪贴板无路径', pasteFail: '粘贴失败' },
  en: { title: 'Select Folder', inputPh: 'Type an absolute path and press Enter', up: 'Up', home: 'Home', select: 'Select this folder', cancel: 'Cancel', empty: '(empty)', loadErr: 'Read failed',
        fav: 'Favorites', recent: 'Recent', filterPh: 'Filter current list', searchPh: 'Recursive search', newFolder: 'New', addFav: 'Add favorite', searching: 'Searching…', noResults: 'No matches', searchResults: 'Search results', clear: 'Clear', newPh: 'New folder name', createErr: 'Create failed', root: 'Locations', copyPath: 'Copy path', pastePath: 'Paste path', copiedPath: 'Path copied', pasteEmpty: 'Clipboard has no path', pasteFail: 'Paste failed' }
}


function t(k) {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'zh'
  return UI[lang][k]
}


export { t }
