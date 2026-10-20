import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, listWords } from '../server/lib/database.mjs'
import { buildEmbeddings, enrichDefinition, ensureEnrichmentJobs, processDefinitionJobs, rebuildNeighbors } from '../server/lib/enrichment.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)), db = openDatabase(join(ROOT, process.env.DATA_DIR || 'data', 'word-studio.db'))
const config = {
  dictionaryUrl: (process.env.DICTIONARY_API || 'https://api.dictionaryapi.dev/api/v2/entries/en').replace(/\/$/, ''),
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma',
  chatModel: process.env.OLLAMA_CHAT_MODEL || 'qwen3:4b',
}

const definitionLimit = Math.max(0, Number(process.env.DEFINITION_LIMIT || 80)), phraseLimit = Math.max(0, Number(process.env.PHRASE_DEFINITION_LIMIT || 12))
console.log(`Preparing enrichment jobs for ${listWords(db).length} cards…`)
if (process.env.RETRY_FAILED !== '0') {
  const reset = db.prepare("UPDATE enrichment_jobs SET status='pending',attempts=0,error=NULL,updated_at=? WHERE kind='definition' AND status='failed'").run(new Date().toISOString())
  if (reset.changes) console.log(`Reset ${reset.changes} failed definition jobs for a clean retry.`)
}
console.log(`Queued ${ensureEnrichmentJobs(db, config.embeddingModel)} new jobs.`)

if (definitionLimit) {
  const definitions = await processDefinitionJobs(db, config, { limit: definitionLimit, onProgress: state => { if ((state.done + state.failed) % 10 === 0) console.log(`Definitions ${state.done + state.failed}/${state.total} (${state.failed} failed)`) } })
  console.log('Definition batch:', definitions)
}

if (phraseLimit) {
  const phrases = listWords(db).filter(word => word.term.includes(' ') && !word.definition).slice(0, phraseLimit)
  let done = 0
  for (const phrase of phrases) {
    try { await enrichDefinition(db, phrase, config); done += 1; console.log(`Phrase definition ${done}/${phrases.length}: ${phrase.term}`) }
    catch (error) { console.warn(`Phrase definition failed for ${phrase.term}: ${error.message}`) }
  }
}

const embeddings = await buildEmbeddings(db, config, { batchSize: 32, onProgress: state => { if (state.done % 160 === 0 || state.done === state.total) console.log(`Embeddings ${state.done}/${state.total}`) } })
console.log('Embedding build:', embeddings)
const neighbors = rebuildNeighbors(db, config, { limit: 24, onProgress: state => { if (state.done % 100 === 0 || state.done === state.total) console.log(`Neighbour caches ${state.done}/${state.total}`) } })
console.log('Neighbour build:', neighbors)
db.close()
