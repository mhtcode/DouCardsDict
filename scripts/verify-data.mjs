import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listWords, openDatabase } from '../server/lib/database.mjs'
import { embeddingSourceHash } from '../server/lib/enrichment.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)), db = openDatabase(join(ROOT, process.env.DATA_DIR || 'data', 'word-studio.db'))
const model = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma'
const words = listWords(db), total = words.length
const vectors = db.prepare("SELECT COUNT(*) count,MIN(dimension) minDimension,MAX(dimension) maxDimension FROM embeddings WHERE model=? AND status='complete' AND vector IS NOT NULL").get(model)
const vectorHashes = new Map(db.prepare("SELECT word_id,source_hash FROM embeddings WHERE model=? AND status='complete' AND vector IS NOT NULL").all(model).map(row => [Number(row.word_id), row.source_hash]))
const staleVectors = words.filter(word => vectorHashes.get(Number(word.id)) !== embeddingSourceHash(word)).map(word => word.term)
const explicit = db.prepare("SELECT COUNT(DISTINCT word_id) count FROM enrichment_jobs WHERE kind='embedding' AND status IN ('pending','running','failed')").get().count
const neighbors = db.prepare('SELECT type,COUNT(*) count FROM neighbor_cache WHERE model=? GROUP BY type ORDER BY type').all(model)
const definitions = db.prepare("SELECT COUNT(*) count FROM words WHERE definition IS NOT NULL AND trim(definition)<>''").get().count
const definitionJobs = db.prepare("SELECT status,COUNT(*) count FROM enrichment_jobs WHERE kind='definition' GROUP BY status ORDER BY status").all()
const incompleteDefinitionJobs = definitionJobs.filter(row => row.status !== 'complete').reduce((sum, row) => sum + Number(row.count), 0)
const reviews = db.prepare('SELECT COUNT(*) count FROM reviews').get().count
const fsrs = db.prepare('SELECT COUNT(*) count FROM reviews WHERE fsrs_state IS NOT NULL').get().count
const sync = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get()
const result = { total, definitions, definitionJobs, vectors, staleVectors: staleVectors.length, explicitEmbeddingStatus: explicit, neighbors, reviews, fsrsReviews: fsrs, lastSync: sync }
console.log(JSON.stringify(result, null, 2))
if (Number(vectors.count) + Number(explicit) < Number(total)) throw new Error('Some cards have neither a vector nor an explicit embedding job state')
if (staleVectors.length) throw new Error(`${staleVectors.length} vectors do not match their current definition/example source`)
if (Number(definitions) !== Number(total) || incompleteDefinitionJobs) throw new Error(`${Number(total) - Number(definitions)} cards still lack definitions and ${incompleteDefinitionJobs} definition jobs are incomplete`)
if (neighbors.length !== 6 || neighbors.some(row => Number(row.count) !== Number(total))) throw new Error('One or more relationship-cache engines are incomplete')
if (Number(reviews) !== Number(fsrs)) throw new Error('Legacy review rows were not all migrated to FSRS fields')
db.close()
