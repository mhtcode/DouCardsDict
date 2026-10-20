import { describe, expect, it } from 'vitest'
import { addTile, chunksFor, clozeFor, expectedForMode, maskedPattern, removeLastTile, shuffledTiles, tileAnswer } from './practice'
import type { Word } from '../types'

const word: Word = { id: 1, term: 'take care', persian: 'مراقب بودن', sentence: 'Please take care on the way home.' }

describe('practice helpers', () => {
  it('uses sentence targets for learner-controlled dictation and dictogloss', () => {
    expect(expectedForMode(word, 'dictation-machine')).toBe(word.sentence)
    expect(expectedForMode(word, 'dictogloss')).toBe(word.sentence)
    expect(expectedForMode(word, 'transcription')).toBe(word.term)
  })

  it('creates a useful cloze and chunk sequence', () => {
    expect(clozeFor(word)).toContain('••••••')
    expect(chunksFor('I stayed home, because it rained. Then I read.').length).toBeGreaterThan(1)
  })

  it('supports shuffled tiles, answer slots, removal and keyboard-equivalent placement', () => {
    const tiles = shuffledTiles(word.term, () => 0.4)
    expect(tiles).toHaveLength(8)
    let placed = addTile([], tiles.find(tile => tile.char === 't')!)
    placed = addTile(placed, tiles.find(tile => tile.char === 'a')!)
    expect(tileAnswer(placed, word.term)).toBe('ta ')
    expect(removeLastTile(placed)).toHaveLength(1)
    expect(new Set(tiles.map(tile => tile.id)).size).toBe(tiles.length)
  })

  it('produces progressive masked patterns without losing punctuation', () => {
    expect(maskedPattern("don't", 1)).toBe("d • • ' •")
  })
})
