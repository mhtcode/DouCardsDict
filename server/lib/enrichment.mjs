import { z } from 'zod'
import { contentHash, clean } from './text.mjs'
import { allSimilarityTypes, blobToFloat32, buildFeatureIndex, float32ToBlob } from './similarity.mjs'
import { listWords, nowIso } from './database.mjs'

const TYPES = ['semantic', 'context', 'pronunciation', 'spelling', 'morphology', 'hybrid']
const Enrichment = z.object({
  definition: z.string().min(3).max(500),
  partOfSpeech: z.string().max(80).default('expression'),
  phonetic: z.string().max(120).default(''),
  example: z.string().max(500).default(''),
  contrastNote: z.string().max(700).default(''),
})
const truncate = (value, maximum) => clean(String(value || '')).slice(0, maximum)
const normalizedEnrichment = value => Enrichment.parse({
  definition: truncate(value?.definition, 500), partOfSpeech: truncate(value?.partOfSpeech, 80) || 'expression',
  phonetic: truncate(value?.phonetic, 120), example: truncate(value?.example, 500), contrastNote: truncate(value?.contrastNote, 700),
})

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20_000) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...options, signal: controller.signal }) } finally { clearTimeout(timer) }
}

export function ensureEnrichmentJobs(db, model) {
  db.prepare("UPDATE enrichment_jobs SET status='pending',updated_at=? WHERE status='running'").run(nowIso())
  const words = listWords(db), insert = db.prepare(`INSERT INTO enrichment_jobs(word_id,kind,content_hash,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(word_id,kind,content_hash) DO NOTHING`)
  const embedding = db.prepare('SELECT status,source_hash FROM embeddings WHERE word_id=? AND model=?')
  let queued = 0
  db.exec('BEGIN')
  try {
    for (const word of words) {
      const stamp = nowIso()
      if (!word.definition) { const result = insert.run(word.id, 'definition', word.content_hash, stamp, stamp); queued += Number(result.changes) }
      const source = embeddingSourceHash(word)
      const existing = embedding.get(word.id, model)
      if (!existing || existing.source_hash !== source || existing.status !== 'complete') { const result = insert.run(word.id, 'embedding', source, stamp, stamp); queued += Number(result.changes) }
      const result = insert.run(word.id, 'neighbors', word.content_hash, stamp, stamp); queued += Number(result.changes)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return queued
}

export const embeddingText = word => [word.term, word.definition && `Definition: ${word.definition}`, (word.example_sentence || word.sentence) && `Example: ${word.example_sentence || word.sentence}`].filter(Boolean).join('\n')
export const embeddingSourceHash = word => contentHash(embeddingText(word))

async function dictionaryDefinition(word, dictionaryUrl) {
  if (clean(word.term).includes(' ')) return null
  const response = await fetchWithTimeout(`${dictionaryUrl}/${encodeURIComponent(clean(word.term))}`, { headers: { accept: 'application/json' } })
  if (!response.ok) return null
  const entries = await response.json(), entry = entries[0], meaning = entry?.meanings?.[0], definition = meaning?.definitions?.[0]
  if (!definition?.definition) return null
  return normalizedEnrichment({ definition: definition.definition, partOfSpeech: meaning.partOfSpeech || '', phonetic: entry.phonetic || entry.phonetics?.find(item => item.text)?.text || '', example: definition.example || word.sentence || '', contrastNote: '' })
}

async function ollamaDefinition(word, ollamaUrl, chatModel) {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['definition', 'partOfSpeech', 'phonetic', 'example', 'contrastNote'],
    properties: {
      definition: { type: 'string', minLength: 3, maxLength: 500 }, partOfSpeech: { type: 'string', maxLength: 80 }, phonetic: { type: 'string', maxLength: 120 },
      example: { type: 'string', maxLength: 500 }, contrastNote: { type: 'string', maxLength: 700 },
    },
  }
  const prompt = `Explain this English word or expression for an intermediate learner. Be concise and English-only. Keep the definition and example under 500 characters and the contrast note under 700 characters. The contrast note should distinguish it from easily confused or related expressions when useful. Term: ${word.term}\nLearner sentence: ${word.sentence || '(none)'}`
  let lastValue = null, lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: chatModel, stream: false, think: false, format: schema, options: { temperature: 0 }, messages: [{ role: 'system', content: `Return only valid JSON matching the supplied schema. Never translate to Persian.${attempt ? ' Your previous response violated a length constraint; shorten every field.' : ''}` }, { role: 'user', content: prompt }] }) }, 120_000)
    if (!response.ok) throw new Error(`Ollama definition request returned ${response.status}`)
    const payload = await response.json()
    try {
      lastValue = JSON.parse(payload.message?.content || '{}')
      const parsed = Enrichment.safeParse(lastValue)
      if (parsed.success) return parsed.data
      lastError = parsed.error
    } catch (error) { lastError = error }
  }
  if (lastValue?.definition) return normalizedEnrichment(lastValue)
  throw lastError || new Error('Ollama returned an invalid definition')
}

export async function enrichDefinition(db, word, config) {
  let result = null, source = 'dictionary'
  try { result = await dictionaryDefinition(word, config.dictionaryUrl) } catch {}
  if (!result) { source = config.chatModel; result = await ollamaDefinition(word, config.ollamaUrl, config.chatModel) }
  const stamp = nowIso()
  db.prepare(`UPDATE words SET definition=?,part_of_speech=?,phonetic=?,example_sentence=?,contrast_note=?,enrichment_status='defined',updated_at=? WHERE id=?`).run(result.definition, result.partOfSpeech, result.phonetic, result.example, result.contrastNote, stamp, word.id)
  db.prepare(`UPDATE enrichment_jobs SET status='complete',attempts=attempts+1,error=NULL,updated_at=? WHERE word_id=? AND kind='definition' AND content_hash=?`).run(stamp, word.id, word.job_content_hash || word.content_hash)
  return { id: word.id, source }
}

export async function buildEmbeddings(db, config, { limit = Infinity, batchSize = 32, onProgress } = {}) {
  const words = listWords(db), existingQuery = db.prepare('SELECT status,source_hash FROM embeddings WHERE word_id=? AND model=?')
  const candidates = words.filter(word => { const existing = existingQuery.get(word.id, config.embeddingModel); return !existing || existing.status !== 'complete' || existing.source_hash !== embeddingSourceHash(word) }).slice(0, limit)
  const save = db.prepare(`INSERT INTO embeddings(word_id,model,dimension,vector,source_hash,status,error,built_at) VALUES(?,?,?,?,?,'complete',NULL,?) ON CONFLICT(word_id,model) DO UPDATE SET dimension=excluded.dimension,vector=excluded.vector,source_hash=excluded.source_hash,status='complete',error=NULL,built_at=excluded.built_at`)
  let done = 0
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize)
    const response = await fetchWithTimeout(`${config.ollamaUrl}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.embeddingModel, input: batch.map(embeddingText), truncate: true }) }, 180_000)
    if (!response.ok) throw new Error(`Ollama embedding request returned ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== batch.length) throw new Error('Ollama returned an unexpected embedding batch')
    const stamp = nowIso()
    db.exec('BEGIN')
    try {
      batch.forEach((word, offset) => {
        const vector = payload.embeddings[offset]
        save.run(word.id, config.embeddingModel, vector.length, float32ToBlob(vector), embeddingSourceHash(word), stamp)
        db.prepare(`UPDATE enrichment_jobs SET status='complete',attempts=attempts+1,error=NULL,updated_at=? WHERE word_id=? AND kind='embedding'`).run(stamp, word.id)
        db.prepare(`UPDATE words SET enrichment_status='embedded' WHERE id=?`).run(word.id)
      })
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    done += batch.length
    onProgress?.({ done, total: candidates.length })
  }
  db.prepare(`UPDATE enrichment_jobs SET status='complete',error=NULL,updated_at=? WHERE kind='embedding' AND EXISTS(SELECT 1 FROM embeddings e WHERE e.word_id=enrichment_jobs.word_id AND e.model=? AND e.status='complete')`).run(nowIso(), config.embeddingModel)
  return { done, total: candidates.length, model: config.embeddingModel }
}

export function loadEmbeddingMap(db, model) {
  return new Map(db.prepare("SELECT word_id,vector FROM embeddings WHERE model=? AND status='complete' AND vector IS NOT NULL").all(model).map(row => [Number(row.word_id), blobToFloat32(row.vector)]))
}

export function rebuildNeighbors(db, config, { wordIds, limit = 24, onProgress } = {}) {
  const words = listWords(db), wordMap = new Map(words.map(word => [Number(word.id), word])), embeddings = loadEmbeddingMap(db, config.embeddingModel), index = buildFeatureIndex(words, embeddings)
  const targets = wordIds?.length ? wordIds.map(id => wordMap.get(Number(id))).filter(Boolean) : words
  const save = db.prepare(`INSERT INTO neighbor_cache(word_id,type,model,matches_json,source_hash,built_at) VALUES(?,?,?,?,?,?) ON CONFLICT(word_id,type,model) DO UPDATE SET matches_json=excluded.matches_json,source_hash=excluded.source_hash,built_at=excluded.built_at`)
  const stamp = nowIso()
  db.exec('BEGIN')
  try {
    targets.forEach((word, targetIndex) => {
      const byType = allSimilarityTypes(word, words, index, limit)
      for (const type of TYPES) save.run(word.id, type, config.embeddingModel, JSON.stringify(byType[type]), word.content_hash, stamp)
      db.prepare(`UPDATE enrichment_jobs SET status='complete',attempts=attempts+1,error=NULL,updated_at=? WHERE word_id=? AND kind='neighbors'`).run(stamp, word.id)
      db.prepare(`UPDATE words SET enrichment_status='complete' WHERE id=?`).run(word.id)
      if (targetIndex > 0 && targetIndex % 25 === 0) onProgress?.({ done: targetIndex, total: targets.length })
    })
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  onProgress?.({ done: targets.length, total: targets.length })
  return { done: targets.length, types: TYPES, model: config.embeddingModel }
}

export async function processDefinitionJobs(db, config, { limit = 25, onProgress } = {}) {
  const jobs = db.prepare(`SELECT j.id job_id,j.content_hash job_content_hash,j.attempts job_attempts,w.* FROM enrichment_jobs j JOIN words w ON w.id=j.word_id WHERE j.kind='definition' AND j.status IN ('pending','failed') AND j.attempts<4 ORDER BY j.id LIMIT ?`).all(limit)
  let done = 0, failed = 0
  for (const job of jobs) {
    db.prepare("UPDATE enrichment_jobs SET status='running',updated_at=? WHERE id=?").run(nowIso(), job.job_id)
    try { await enrichDefinition(db, job, config); done += 1 }
    catch (error) { failed += 1; db.prepare("UPDATE enrichment_jobs SET status='failed',attempts=attempts+1,error=?,updated_at=? WHERE id=?").run(String(error.message).slice(0, 1000), nowIso(), job.job_id) }
    onProgress?.({ done, failed, total: jobs.length })
  }
  return { done, failed, total: jobs.length }
}

export function enrichmentStatus(db, config) {
  const embeddings = db.prepare(`SELECT status,COUNT(*) count FROM embeddings WHERE model=? GROUP BY status`).all(config.embeddingModel)
  const jobs = db.prepare(`SELECT kind,status,COUNT(*) count FROM enrichment_jobs GROUP BY kind,status`).all()
  const ollamaModels = { embedding: config.embeddingModel, language: config.chatModel }
  return { embeddings, jobs, models: ollamaModels }
}
