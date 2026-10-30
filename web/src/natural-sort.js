export function naturalCompare(a, b) {
  const sa = String(a)
  const sb = String(b)
  let i = 0,
    j = 0
  while (i < sa.length && j < sb.length) {
    const da = sa[i] >= '0' && sa[i] <= '9'
    const db = sb[j] >= '0' && sb[j] <= '9'
    if (da && db) {
      let na = ''
      while (i < sa.length && sa[i] >= '0' && sa[i] <= '9') na += sa[i++]
      let nb = ''
      while (j < sb.length && sb[j] >= '0' && sb[j] <= '9') nb += sb[j++]
      const diff = Number(na) - Number(nb)
      if (diff !== 0) return diff
    } else if (da !== db) {
      return da ? 1 : -1
    } else {
      const cmp = sa[i].localeCompare(sb[j], 'zh')
      if (cmp !== 0) return cmp
      i++
      j++
    }
  }
  return sa.length - sb.length
}