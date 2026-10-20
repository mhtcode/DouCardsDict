import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, importCards, listWords } from '../server/lib/database.mjs'
import { answerAlignment, longestSavedMatch, rankSearch } from '../server/lib/text.mjs'
import { buildFeatureIndex, pairScores } from '../server/lib/similarity.mjs'
import { automaticRating, legacyReviewToCard, scheduleReview, skippedSchedule } from '../server/lib/scheduler.mjs'
import { hashPassword, verifyPassword } from '../server/lib/security.mjs'
import { fourHourDelay, nextScheduledAt, retryDelay } from '../server/lib/sync.mjs'
import { enrichDefinition } from '../server/lib/enrichment.mjs'

const temporary = []
afterEach(() => { vi.restoreAllMocks(); while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true }) })

describe('search and Persian resolution', () => {
  const words = [
    { id: 1, term: 'take care', persian: 'مراقب بودن', sentence: 'Take care on the road.', definition: 'be cautious' },
    { id: 2, term: 'care', persian: 'مراقبت', sentence: 'Care matters.', definition: 'attention' },
    { id: 3, term: 'stake', persian: 'سهم', sentence: 'A stake in it.', definition: 'a share' },
  ]
  it('ranks exact and prefix matches above fuzzy matches', () => expect(rankSearch(words, 'care').map(x => x.id).slice(0, 2)).toEqual([2, 1]))
  it('selects exact phrases first and otherwise the longest saved match', () => {
    expect(longestSavedMatch(words, 'take care').id).toBe(1)
    expect(longestSavedMatch(words, 'Please take care today').id).toBe(1)
  })
  it('aligns edits for immediate correction', () => { const result = answerAlignment('stain', 'satin'); expect(result.distance).toBeGreaterThan(0); expect(result.operations.some(x => x.type !== 'equal')).toBe(true) })
})

describe('similarity signals', () => {
  it('finds spelling, phonetic, context and semantic relationships', () => {
    const words = [
      { id: 1, term: 'stain', sentence: 'remove a stain', definition: 'a dirty mark', phonetic: '/steɪn/' },
      { id: 2, term: 'strain', sentence: 'remove a strain', definition: 'pressure or tension', phonetic: '/streɪn/' },
      { id: 3, term: 'mark', sentence: 'remove a dirty mark', definition: 'a stain', phonetic: '/mɑːk/' },
    ]
    const index = buildFeatureIndex(words, new Map([[1, [1, 0]], [2, [.7, .3]], [3, [.98, .02]]]))
    const sound = pairScores(words[0], words[1], index), meaning = pairScores(words[0], words[2], index)
    expect(sound.spelling).toBeGreaterThan(.6)
    expect(sound.pronunciation).toBeGreaterThan(.5)
    expect(meaning.semantic).toBeGreaterThan(.9)
    expect(meaning.context).toBeGreaterThan(0)
  })
})

describe('FSRS migration and automatic grading', () => {
  it('maps old review progress into an FSRS card and schedules the next state', () => {
    const old = { ease: 2.6, interval_days: 1, repetitions: 1, lapses: 0, due_at: '2026-08-04T00:00:00Z', attempts: 1, updated_at: '2026-08-03T00:00:00Z' }
    expect(legacyReviewToCard(old).reps).toBe(1)
    const result = scheduleReview(old, 3, new Date('2026-08-04T00:00:00Z'))
    expect(result.card.reps).toBe(2)
    expect(result.card.due.getTime()).toBeGreaterThan(new Date('2026-08-04T00:00:00Z').getTime())
  })
  it('uses correctness, time, replay and hints while leaving skip accuracy neutral', () => {
    expect(automaticRating({ expected: 'stain', answer: 'stain', elapsedMs: 4000 })).toBe(4)
    expect(automaticRating({ expected: 'stain', answer: 'stone', elapsedMs: 70000, replayCount: 4, hintsUsed: 3 })).toBeLessThan(3)
    expect(skippedSchedule(new Date('2026-08-03T00:00:00Z')).toISOString()).toBe('2026-08-03T00:15:00.000Z')
  })
})

describe('database idempotency and changed-card enrichment', () => {
  it('preserves rows, adds no duplicate on second sync and queues only changed content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ews-db-')); temporary.push(dir)
    let db = openDatabase(join(dir, 'words.db'))
    const card = { front: 'stain', back: 'لکه', hint: 'Remove the stain.', publishedAt: '2026-01-01T00:00:00Z' }
    expect(importCards(db, [card])).toMatchObject({ added: 1, updated: 0, unchanged: 0 })
    expect(importCards(db, [card])).toMatchObject({ added: 0, updated: 0, unchanged: 1, enrichmentQueued: 0 })
    expect(importCards(db, [{ ...card, back: 'لکه، اثر' }])).toMatchObject({ added: 0, updated: 1, unchanged: 0 })
    db.prepare(`INSERT INTO reviews(word_id,attempts,correct,updated_at) VALUES(1,4,3,'2026-01-02T00:00:00Z')`).run()
    db.close(); db = openDatabase(join(dir, 'words.db'))
    expect(listWords(db)).toHaveLength(1)
    expect(db.prepare('SELECT attempts,correct FROM reviews WHERE word_id=1').get()).toEqual({ attempts: 4, correct: 3 })
    expect(db.prepare("SELECT COUNT(*) count FROM enrichment_jobs WHERE status='pending'").get().count).toBeGreaterThan(0)
    db.close()
  })
  it('completes the exact queued definition revision after card content changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ews-job-')); temporary.push(dir)
    const db = openDatabase(join(dir, 'words.db'))
    importCards(db, [{ front: 'stain', back: 'لکه', hint: 'Remove the stain.', publishedAt: '2026-01-01T00:00:00Z' }])
    const word = listWords(db)[0], queuedHash = 'older-card-revision'
    db.prepare("DELETE FROM enrichment_jobs WHERE word_id=? AND kind='definition'").run(word.id)
    db.prepare("INSERT INTO enrichment_jobs(word_id,kind,content_hash,status,created_at,updated_at) VALUES(?,'definition',?,'running',?,?)").run(word.id, queuedHash, new Date().toISOString(), new Date().toISOString())
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ phonetic: '/steɪn/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A discoloured mark.', example: 'The stain disappeared.' }] }] }]), { status: 200 }))
    await enrichDefinition(db, { ...word, job_content_hash: queuedHash }, { dictionaryUrl: 'https://dictionary.test', ollamaUrl: 'http://ollama.test', chatModel: 'qwen3:4b' })
    expect(db.prepare("SELECT status FROM enrichment_jobs WHERE word_id=? AND kind='definition' AND content_hash=?").get(word.id, queuedHash).status).toBe('complete')
    fetchMock.mockRestore(); db.close()
  })
})

describe('security and four-hour automation', () => {
  it('derives and verifies scrypt password hashes', async () => { const hash = await hashPassword('correct horse battery staple'); expect(hash).toMatch(/^scrypt\$/); expect(await verifyPassword('correct horse battery staple', hash)).toBe(true); expect(await verifyPassword('wrong password', hash)).toBe(false) })
  it('schedules exactly four hours and applies bounded retry backoff', () => { expect(fourHourDelay()).toBe(14_400_000); expect(nextScheduledAt('2026-08-03T00:00:00Z')).toBe('2026-08-03T04:00:00.000Z'); expect(retryDelay(1)).toBe(60_000); expect(retryDelay(9)).toBe(3_600_000) })
})
