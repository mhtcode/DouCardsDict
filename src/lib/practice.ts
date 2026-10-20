import type { AlignmentOperation, PracticeMode, Word } from '../types'

export const PRACTICE_MODES: { id: PracticeMode; label: string; short: string }[] = [
  { id: 'transcription', label: 'Word transcription', short: 'Hear it, type it' },
  { id: 'dictation-machine', label: 'Dictation machine', short: 'Control every chunk' },
  { id: 'cloze', label: 'Context cloze', short: 'Notice it in context' },
  { id: 'dictogloss', label: 'Sentence reconstruction', short: 'Rebuild what you hear' },
  { id: 'sound-confusion', label: 'Sound discrimination', short: 'Separate similar sounds' },
  { id: 'letter-tiles', label: 'Letter builder', short: 'Assemble the answer' },
]

export const normalizeAnswer = (value: string) => value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
export const expectedForMode = (word: Word, mode: PracticeMode) => mode === 'dictogloss' || mode === 'dictation-machine' ? (word.sentence || word.term) : word.term
export const chunksFor = (value: string) => value.split(/(?<=[,;:.!?])\s+|\s+(?=(?:and|but|because|while|that|which|to)\b)/i).map(x => x.trim()).filter(Boolean)
export const clozeFor = (word: Word) => (word.sentence || `Use “${word.term}” in a sentence.`).replace(new RegExp(word.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '••••••')

export function maskedPattern(value: string, visible = 0) {
  let count = 0
  return [...value].map(char => /[a-z]/i.test(char) ? (count++ < visible ? char : '•') : char).join(' ')
}

export function shuffledTiles(value: string, random = Math.random) {
  const tiles = [...value].filter(char => char !== ' ').map((char, index) => ({ id: `${index}-${char}`, char }))
  for (let i = tiles.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]] }
  return tiles
}

export function addTile(answer: { id: string; char: string }[], tile: { id: string; char: string }) { return answer.some(item => item.id === tile.id) ? answer : [...answer, tile] }
export function removeLastTile(answer: { id: string; char: string }[]) { return answer.slice(0, -1) }
export function tileAnswer(answer: { id: string; char: string }[], expected: string) {
  const compact = answer.map(item => item.char).join(''), words = expected.trim().split(/\s+/)
  if (words.length === 1) return compact
  let index = 0
  return words.map(word => { const part = compact.slice(index, index + word.length); index += word.length; return part }).join(' ')
}

export function hintFor(word: Word, level: number, expected: string) {
  const example = word.example || word.example_sentence || word.sentence
  const hints = [
    { label: 'Definition', value: word.definition || 'Definition is still being enriched.' },
    { label: 'Phonetics', value: word.phonetic || 'No phonetic notation is cached yet.' },
    { label: 'Letter pattern', value: `${expected.length} characters · ${maskedPattern(expected)}` },
    { label: 'Masked example', value: example ? example.replace(new RegExp(word.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '••••••') : 'No example saved.' },
    { label: 'First letter', value: maskedPattern(expected, 1) },
    { label: 'Persian', value: word.persian || 'No Persian meaning saved.' },
    { label: 'Answer', value: expected },
  ]
  return hints[Math.min(level, hints.length - 1)]
}

export function alignmentParts(operations: AlignmentOperation[]) {
  return operations.map((operation, index) => ({ ...operation, key: `${index}-${operation.type}-${operation.expected}-${operation.actual}` }))
}
