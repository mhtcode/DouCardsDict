import { doubleMetaphone } from 'double-metaphone'
import { clean, damerauLevenshtein, jaroWinkler, normalizeEnglish } from './text.mjs'

const STOP = new Set('the a an and or but if in on at to for from with of is are was were be been being it its this that these those i you he she we they my your his her our their as by do does did not no so than then very can could should would will just into about over after before there here something someone some any all each every more most much many also up out'.split(' '))
const PREFIXES = ['anti', 'auto', 'dis', 'en', 'em', 'fore', 'im', 'in', 'inter', 'mid', 'mis', 'non', 'over', 'pre', 're', 'semi', 'sub', 'super', 'trans', 'un', 'under']
const SUFFIXES = ['able', 'al', 'ance', 'ence', 'er', 'ful', 'ible', 'ic', 'ing', 'ion', 'ist', 'ity', 'ive', 'less', 'ly', 'ment', 'ness', 'ous', 'ship', 'tion']

const tokens = value => normalizeEnglish(value).split(' ').filter(token => token.length > 2 && !STOP.has(token))
const set = values => new Set(values)
const ngrams = (value, n) => { const text = ` ${normalizeEnglish(value)} `, output = new Set(); for (let i = 0; i <= text.length - n; i += 1) output.add(text.slice(i, i + n)); return output }
const jaccard = (a, b) => { const same = [...a].filter(value => b.has(value)).length; return same / Math.max(1, new Set([...a, ...b]).size) }
export const cosine = (a, b) => { if (!a || !b || a.length !== b.length) return 0; let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 } return dot / Math.max(1e-9, Math.sqrt(aa * bb)) }

function ipaDistance(a, b) {
  const left = clean(a).replace(/[\/\[\]]/g, ''), right = clean(b).replace(/[\/\[\]]/g, '')
  if (!left || !right) return null
  return 1 - damerauLevenshtein(left, right) / Math.max(left.length, right.length, 1)
}

function metaphoneScore(A, B) {
  if (!A.length || !B.length) return 0
  if (A.some(code => B.includes(code))) return 1
  return Math.max(...A.flatMap(left => B.map(right => jaroWinkler(left, right))))
}

function morphologyScore(left, right) {
  const tokenScore = jaccard(left.termTokens, right.termTokens)
  const affixScore = jaccard(left.affixes, right.affixes)
  const structure = Math.min(left.termTokenCount, right.termTokenCount) / Math.max(left.termTokenCount, right.termTokenCount, 1)
  return 0.52 * tokenScore + 0.3 * affixScore + 0.18 * structure
}

export function buildFeatureIndex(words, embeddingMap = new Map()) {
  const documentSets = words.map(word => set(tokens(`${word.term} ${word.definition || ''} ${word.sentence || ''}`)))
  const frequencies = new Map()
  documentSets.forEach(document => document.forEach(token => frequencies.set(token, (frequencies.get(token) || 0) + 1)))
  const idf = new Map([...frequencies].map(([token, count]) => [token, Math.log((words.length + 1) / (count + 1)) + 1]))
  const features = new Map(words.map((word, index) => {
    const termTokens = set(tokens(word.term)), list = [...termTokens]
    const affixes = set([...PREFIXES.filter(x => list.some(t => t.startsWith(x))), ...SUFFIXES.filter(x => list.some(t => t.endsWith(x)))])
    return [Number(word.id), { document: documentSets[index], trigrams: ngrams(word.term, 3), embedding: embeddingMap.get(Number(word.id)) || null, metaphones: doubleMetaphone(word.term).filter(Boolean), termTokens, termTokenCount: tokens(word.term).length, affixes }]
  }))
  return { idf, features }
}

function tfidfCos(a, b, idf) {
  const all = new Set([...a, ...b]); let dot = 0, aa = 0, bb = 0
  for (const token of all) { const left = a.has(token) ? idf.get(token) || 1 : 0, right = b.has(token) ? idf.get(token) || 1 : 0; dot += left * right; aa += left ** 2; bb += right ** 2 }
  return dot / Math.max(1e-9, Math.sqrt(aa * bb))
}

export function pairScores(left, right, index) {
  const A = index.features.get(Number(left.id)), B = index.features.get(Number(right.id))
  const edit = 1 - damerauLevenshtein(left.term, right.term) / Math.max(normalizeEnglish(left.term).length, normalizeEnglish(right.term).length, 1)
  const spelling = Math.max(0, 0.5 * jaroWinkler(left.term, right.term) + 0.3 * edit + 0.2 * jaccard(A.trigrams, B.trigrams))
  const context = tfidfCos(A.document, B.document, index.idf)
  const ipa = ipaDistance(left.phonetic, right.phonetic)
  const pronunciation = Math.max(0, ipa === null ? metaphoneScore(A.metaphones, B.metaphones) : 0.72 * ipa + 0.28 * metaphoneScore(A.metaphones, B.metaphones))
  const morphology = morphologyScore(A, B)
  const semantic = A.embedding && B.embedding ? cosine(A.embedding, B.embedding) : 0.82 * context + 0.18 * morphology
  const hybrid = 0.38 * semantic + 0.2 * context + 0.17 * spelling + 0.14 * pronunciation + 0.11 * morphology
  return { semantic, context, pronunciation, spelling, morphology, hybrid }
}

export function similarWords(word, words, index, type = 'hybrid', limit = 10) {
  const validType = ['semantic', 'context', 'pronunciation', 'spelling', 'morphology', 'hybrid'].includes(type) ? type : 'hybrid'
  return words.filter(item => Number(item.id) !== Number(word.id)).map(item => {
    const signals = pairScores(word, item, index)
    return { id: item.id, term: item.term, sentence: item.sentence, persian: item.persian, definition: item.definition, phonetic: item.phonetic, score: signals[validType], signals, reason: validType }
  }).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function allSimilarityTypes(word, words, index, limit = 24) {
  const types = ['semantic', 'context', 'pronunciation', 'spelling', 'morphology', 'hybrid']
  const scored = words.filter(item => Number(item.id) !== Number(word.id)).map(item => ({ item, signals: pairScores(word, item, index) }))
  return Object.fromEntries(types.map(type => [type, scored.map(({ item, signals }) => ({ id: item.id, term: item.term, sentence: item.sentence, persian: item.persian, definition: item.definition, phonetic: item.phonetic, score: signals[type], signals, reason: type })).sort((a, b) => b.score - a.score).slice(0, limit)]))
}

export const float32ToBlob = values => Buffer.from(new Float32Array(values).buffer)
export function blobToFloat32(blob) {
  if (!blob) return null
  const buffer = Buffer.from(blob)
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return Array.from(new Float32Array(copy.buffer))
}
