import { createHash } from 'node:crypto'

export const clean = (value = '') => String(value).trim().replace(/\s+/g, ' ')
export const normalizeEnglish = (value = '') => clean(value).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' -]/g, '')
export const contentHash = (...parts) => createHash('sha256').update(parts.map(clean).join('\u241f')).digest('hex')

export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const header = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, ''))
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(header.map((name, index) => [name, values[index] || ''])))
}

export function damerauLevenshtein(left, right) {
  const a = normalizeEnglish(left), b = normalizeEnglish(right)
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? j ? 0 : i : j))
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost)
      }
    }
  }
  return matrix[a.length][b.length]
}

export function jaroWinkler(left, right) {
  const a = normalizeEnglish(left), b = normalizeEnglish(right)
  if (a === b) return 1
  if (!a || !b) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const matchedA = Array(a.length).fill(false), matchedB = Array(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(i + range + 1, b.length); j += 1) {
      if (!matchedB[j] && a[i] === b[j]) { matchedA[i] = matchedB[j] = true; matches += 1; break }
    }
  }
  if (!matches) return 0
  const orderedA = matchedA.map((yes, index) => yes ? a[index] : '').join('')
  const orderedB = matchedB.map((yes, index) => yes ? b[index] : '').join('')
  let transpositions = 0
  for (let i = 0; i < orderedA.length; i += 1) if (orderedA[i] !== orderedB[i]) transpositions += 1
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1
  return jaro + prefix * 0.1 * (1 - jaro)
}

export function rankSearch(words, query, limit = 20) {
  const q = normalizeEnglish(query)
  if (!q) return []
  return words.map(word => {
    const term = normalizeEnglish(word.term)
    const sentence = normalizeEnglish(word.sentence)
    const definition = normalizeEnglish(word.definition)
    let score = 0
    if (term === q) score += 120
    if (term.startsWith(q)) score += 75 - Math.min(20, term.length - q.length)
    if (term.split(' ').some(token => token.startsWith(q))) score += 46
    if (term.includes(q)) score += 38
    if (sentence.includes(q)) score += 16
    if (definition.includes(q)) score += 12
    const distance = damerauLevenshtein(term, q)
    if (q.length > 2 && distance <= Math.max(2, Math.floor(q.length * 0.32))) score += 24 * (1 - distance / Math.max(term.length, q.length, 1))
    score += jaroWinkler(term, q) * 10
    return { ...word, searchScore: score }
  }).filter(item => item.searchScore > 8).sort((a, b) => b.searchScore - a.searchScore || a.term.localeCompare(b.term)).slice(0, limit)
}

export function longestSavedMatch(words, selectedText) {
  const selected = normalizeEnglish(selectedText)
  if (!selected) return null
  const exact = words.find(word => normalizeEnglish(word.term) === selected)
  if (exact) return exact
  const padded = ` ${selected} `
  return words.filter(word => {
    const term = normalizeEnglish(word.term)
    return term && padded.includes(` ${term} `)
  }).sort((a, b) => normalizeEnglish(b.term).length - normalizeEnglish(a.term).length)[0] || null
}

export function answerAlignment(expectedValue, actualValue) {
  const expected = normalizeEnglish(expectedValue), actual = normalizeEnglish(actualValue)
  const rows = expected.length + 1, cols = actual.length + 1
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) dp[i][0] = i
  for (let j = 0; j < cols; j += 1) dp[0][j] = j
  for (let i = 1; i < rows; i += 1) for (let j = 1; j < cols; j += 1) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1))
  }
  const operations = []
  let i = expected.length, j = actual.length
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)) {
      operations.push({ expected: expected[i - 1], actual: actual[j - 1], type: expected[i - 1] === actual[j - 1] ? 'equal' : 'replace' }); i -= 1; j -= 1
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) { operations.push({ expected: expected[i - 1], actual: '', type: 'missing' }); i -= 1 }
    else { operations.push({ expected: '', actual: actual[j - 1], type: 'extra' }); j -= 1 }
  }
  return { expected, actual, distance: dp[expected.length][actual.length], similarity: 1 - dp[expected.length][actual.length] / Math.max(expected.length, actual.length, 1), operations: operations.reverse() }
}
