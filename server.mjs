import http from 'node:http'
import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { answerAlignment, clean, longestSavedMatch, parseCsv, rankSearch } from './server/lib/text.mjs'
import { dueWords, importCards, listWords, nowIso, openDatabase, setting, setSetting } from './server/lib/database.mjs'
import { buildFeatureIndex, similarWords } from './server/lib/similarity.mjs'
import { automaticRating, scheduleReview, skippedSchedule } from './server/lib/scheduler.mjs'
import { fourHourDelay, retryDelay } from './server/lib/sync.mjs'
import { clearSessionCookie, createSessionSecrets, hashPassword, parseCookies, sessionCookie, tokenHash, verifyPassword } from './server/lib/security.mjs'
import { buildEmbeddings, embeddingSourceHash, enrichmentStatus, ensureEnrichmentJobs, loadEmbeddingMap, processDefinitionJobs, rebuildNeighbors } from './server/lib/enrichment.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DATA = process.env.DATA_DIR ? join(ROOT, process.env.DATA_DIR) : join(ROOT, 'data')
const DIST = join(ROOT, 'dist')
await mkdir(DATA, { recursive: true })
const db = openDatabase(join(DATA, 'word-studio.db'))

const config = {
  port: Number(process.env.PORT || 8765),
  deckId: process.env.DUOCARDS_DECK_ID || '',
  syncHours: Math.max(1, Number(process.env.SYNC_INTERVAL_HOURS || 4)),
  dictionaryUrl: (process.env.DICTIONARY_API || 'https://api.dictionaryapi.dev/api/v2/entries/en').replace(/\/$/, ''),
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma',
  chatModel: process.env.OLLAMA_CHAT_MODEL || 'qwen3:4b',
  cookieSecure: process.env.COOKIE_SECURE || 'auto',
  trustProxy: process.env.TRUST_PROXY === '1',
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 30)),
}

const DEFAULT_APP_SETTINGS = {
  profile: { name: 'Masih', email: '' },
  speech: { accent: 'en-GB', voiceName: '', rate: 0.86, pitch: 1, autoPlayPrompt: true },
  practice: { autoAdvanceCorrect: true, correctDelayMs: 1500, autoAdvanceIncorrect: false, incorrectDelayMs: 8000 },
}
const ProfileSettings = z.object({ name: z.string().trim().min(1).max(80), email: z.union([z.literal(''), z.string().trim().email().max(254)]) }).strict()
const SpeechSettings = z.object({ accent: z.enum(['en-GB', 'en-US', 'en-CA', 'en-AU']), voiceName: z.string().max(160), rate: z.number().min(.65).max(1.35), pitch: z.number().min(.7).max(1.3), autoPlayPrompt: z.boolean() }).strict()
const PracticeSettings = z.object({ autoAdvanceCorrect: z.boolean(), correctDelayMs: z.number().int().min(500).max(5000), autoAdvanceIncorrect: z.boolean(), incorrectDelayMs: z.number().int().min(3000).max(20000) }).strict()
const AppSettings = z.object({ profile: ProfileSettings, speech: SpeechSettings, practice: PracticeSettings }).strict()
const SettingsPatch = z.object({ profile: ProfileSettings.partial().optional(), speech: SpeechSettings.partial().optional(), practice: PracticeSettings.partial().optional() }).strict()

function appSettings() {
  try {
    const saved = JSON.parse(setting(db, 'app_settings') || '{}')
    return AppSettings.parse({
      profile: { ...DEFAULT_APP_SETTINGS.profile, ...(saved.profile || {}) },
      speech: { ...DEFAULT_APP_SETTINGS.speech, ...(saved.speech || {}) },
      practice: { ...DEFAULT_APP_SETTINGS.practice, ...(saved.practice || {}) },
    })
  } catch { return structuredClone(DEFAULT_APP_SETTINGS) }
}

function updateAppSettings(patch) {
  const valid = SettingsPatch.parse(patch), current = appSettings()
  const next = AppSettings.parse({
    profile: { ...current.profile, ...(valid.profile || {}) },
    speech: { ...current.speech, ...(valid.speech || {}) },
    practice: { ...current.practice, ...(valid.practice || {}) },
  })
  setSetting(db, 'app_settings', JSON.stringify(next))
  return next
}

if (!setting(db, 'admin_password_hash') && process.env.APP_PASSWORD) setSetting(db, 'admin_password_hash', await hashPassword(process.env.APP_PASSWORD))
if (!listWords(db).length && existsSync(join(ROOT, 'vocabulary.json'))) importCards(db, JSON.parse(await readFile(join(ROOT, 'vocabulary.json'), 'utf8')))
ensureEnrichmentJobs(db, config.embeddingModel)

let words = [], features, syncing = false, enriching = false, syncTimer, enrichmentTimer, nextRunAt = null, enrichmentNextBatchAt = null, syncFailures = 0
const refresh = () => { words = listWords(db); features = buildFeatureIndex(words, loadEmbeddingMap(db, config.embeddingModel)) }
refresh()

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }
const json = (res, status, payload, headers = {}) => { const body = JSON.stringify(payload); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(body) }
async function readBody(req, max = 2_000_000) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > max) throw Object.assign(new Error('Request is too large'), { status: 413 }) } return text }
async function readJson(req) { const text = await readBody(req); try { return text ? JSON.parse(text) : {} } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }) } }
const clientIp = req => clean(config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0] : req.socket.remoteAddress || '')
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp(req))
const isSecure = req => config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && (req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https')))

function activeSession(req) {
  const raw = parseCookies(req.headers.cookie).ews_session
  if (!raw) return null
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(raw), nowIso())
  if (!session) return null
  if (Date.now() - new Date(session.last_seen_at).getTime() > 15 * 60_000) db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(nowIso(), session.id)
  return session
}

function csrfValid(req, session) {
  const token = String(req.headers['x-csrf-token'] || '')
  return token && tokenHash(token) === session.csrf_hash
}

function createSession(req, res) {
  const secrets = createSessionSecrets(), stamp = nowIso(), expires = new Date(Date.now() + config.sessionDays * 86400000)
  db.prepare('INSERT INTO sessions(token_hash,csrf_hash,csrf_token,created_at,last_seen_at,expires_at,user_agent,ip) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash(secrets.token), tokenHash(secrets.csrf), secrets.csrf, stamp, stamp, expires.toISOString(), clean(req.headers['user-agent']), clientIp(req))
  res.setHeader('set-cookie', sessionCookie(secrets.token, { secure: isSecure(req), expires }))
  return { authenticated: true, csrfToken: secrets.csrf, expiresAt: expires.toISOString(), username: appSettings().profile.name }
}

function throttleState(ip) {
  const row = db.prepare('SELECT * FROM login_throttle WHERE ip=?').get(ip)
  if (!row) return { blocked: false, retryAfter: 0 }
  const retryAfter = row.blocked_until ? Math.max(0, Math.ceil((new Date(row.blocked_until).getTime() - Date.now()) / 1000)) : 0
  return { blocked: retryAfter > 0, retryAfter }
}

function recordLoginFailure(ip) {
  const stamp = new Date(), existing = db.prepare('SELECT * FROM login_throttle WHERE ip=?').get(ip)
  const freshWindow = !existing || stamp.getTime() - new Date(existing.window_started_at).getTime() > 15 * 60_000
  const failures = freshWindow ? 1 : existing.failures + 1
  const blockedUntil = failures >= 5 ? new Date(stamp.getTime() + Math.min(30, 2 ** (failures - 5)) * 60_000).toISOString() : null
  db.prepare('INSERT INTO login_throttle(ip,failures,window_started_at,blocked_until) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until').run(ip, failures, freshWindow ? stamp.toISOString() : existing.window_started_at, blockedUntil)
}

function clearThrottle(ip) { db.prepare('DELETE FROM login_throttle WHERE ip=?').run(ip) }

async function syncDeck() {
  if (syncing) return { status: 'busy' }
  if (!config.deckId) throw new Error('DuoCards deck is not configured')
  syncing = true
  const started = nowIso(), run = db.prepare("INSERT INTO sync_runs(started_at,status) VALUES(?,'running') RETURNING id").get(started)
  try {
    const response = await fetch(`https://api.duocards.com/deck-export?deckId=${encodeURIComponent(config.deckId)}`, { headers: { accept: 'text/csv' } })
    if (!response.ok) throw new Error(`DuoCards returned ${response.status}`)
    const result = importCards(db, parseCsv(await response.text()))
    db.prepare("UPDATE sync_runs SET finished_at=?,status='ok',total=?,added=?,updated=?,unchanged=?,enrichment_queued=?,message=? WHERE id=?").run(nowIso(), result.total, result.added, result.updated, result.unchanged, result.enrichmentQueued, 'DuoCards export merged idempotently', run.id)
    syncFailures = 0; refresh(); scheduleSync(fourHourDelay(config.syncHours))
    if (result.added || result.updated) startBackgroundEnrichment()
    return { status: 'ok', ...result, at: nowIso() }
  } catch (error) {
    syncFailures += 1
    db.prepare("UPDATE sync_runs SET finished_at=?,status='error',message=? WHERE id=?").run(nowIso(), String(error.message).slice(0, 1000), run.id)
    scheduleSync(retryDelay(syncFailures, config.syncHours))
    throw error
  } finally { syncing = false }
}

function scheduleSync(delay) {
  if (syncTimer) clearTimeout(syncTimer)
  nextRunAt = new Date(Date.now() + delay).toISOString()
  syncTimer = setTimeout(() => syncDeck().catch(error => console.error('Scheduled DuoCards sync:', error.message)), delay)
  syncTimer.unref()
}

async function startBackgroundEnrichment() {
  if (enriching) return
  enriching = true; enrichmentNextBatchAt = null
  let definitionResult = { done: 0, failed: 0, total: 0 }
  try {
    definitionResult = await processDefinitionJobs(db, config, { limit: 16 })
    await buildEmbeddings(db, config, { limit: 32 })
    const pendingIds = db.prepare("SELECT DISTINCT word_id FROM enrichment_jobs WHERE kind='neighbors' AND status='pending' LIMIT 32").all().map(row => row.word_id)
    if (pendingIds.length) rebuildNeighbors(db, config, { wordIds: pendingIds })
    refresh()
  } catch (error) { console.error('Background enrichment:', error.message) }
  finally {
    enriching = false
    const remaining = Number(db.prepare(`SELECT COUNT(*) count FROM enrichment_jobs WHERE (kind='definition' AND status IN ('pending','failed') AND attempts<4) OR (kind IN ('embedding','neighbors') AND status='pending')`).get().count)
    if (remaining && process.env.DISABLE_BACKGROUND_ENRICHMENT !== '1') {
      clearTimeout(enrichmentTimer)
      const delay = definitionResult.done || definitionResult.total ? 2_000 : 60_000
      enrichmentNextBatchAt = new Date(Date.now() + delay).toISOString()
      enrichmentTimer = setTimeout(() => startBackgroundEnrichment(), delay)
      enrichmentTimer.unref()
    } else enrichmentNextBatchAt = null
  }
}

function enrichmentCoverage() {
  const embeddingRows = db.prepare('SELECT word_id,status,dimension,source_hash,vector FROM embeddings WHERE model=?').all(config.embeddingModel)
  const embeddingsByWord = new Map(embeddingRows.map(row => [Number(row.word_id), row]))
  let currentEmbeddings = 0, staleEmbeddings = 0, dimension = 0
  for (const word of words) {
    const embedding = embeddingsByWord.get(Number(word.id))
    if (embedding?.status === 'complete' && embedding.vector && embedding.source_hash === embeddingSourceHash(word)) { currentEmbeddings += 1; dimension = Number(embedding.dimension || dimension) }
    else staleEmbeddings += 1
  }
  const definitions = Number(db.prepare("SELECT COUNT(*) count FROM words WHERE definition IS NOT NULL AND trim(definition)<>''").get().count)
  const definitionStates = Object.fromEntries(db.prepare(`SELECT j.status,COUNT(*) count FROM enrichment_jobs j JOIN words w ON w.id=j.word_id WHERE j.kind='definition' AND j.content_hash=w.content_hash GROUP BY j.status`).all().map(row => [row.status, Number(row.count)]))
  const neighborTypes = db.prepare('SELECT type,COUNT(DISTINCT word_id) count FROM neighbor_cache WHERE model=? GROUP BY type ORDER BY type').all(config.embeddingModel)
  const completeNeighborWords = Number(db.prepare('SELECT COUNT(*) count FROM (SELECT word_id FROM neighbor_cache WHERE model=? GROUP BY word_id HAVING COUNT(DISTINCT type)=6)').get(config.embeddingModel).count)
  return {
    embeddings: { complete: currentEmbeddings, total: words.length, stale: staleEmbeddings, dimension, model: config.embeddingModel },
    definitions: { complete: definitions, total: words.length, pending: Number(definitionStates.pending || 0), failed: Number(definitionStates.failed || 0), running: Number(definitionStates.running || 0) },
    neighbors: { completeWords: completeNeighborWords, totalWords: words.length, types: neighborTypes.map(row => ({ type: row.type, count: Number(row.count) })) },
    worker: { active: enriching, nextBatchAt: enrichmentNextBatchAt },
  }
}

function progressReport(days, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateKey = value => Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value])).year
    ? (() => { const parts = Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}` })()
    : formatter.format(value)
  const keys = [], seen = new Set()
  for (let offset = 0; keys.length < days && offset < days + 4; offset += 1) {
    const key = dateKey(new Date(Date.now() - offset * 86_400_000))
    if (!seen.has(key)) { seen.add(key); keys.unshift(key) }
  }
  const byDay = new Map(keys.map(key => [key, { date: key, attempts: 0, correct: 0, words: new Set() }]))
  const earliest = new Date(Date.now() - (days + 2) * 86_400_000).toISOString()
  const events = db.prepare('SELECT word_id,similarity,created_at FROM practice_events WHERE skipped=0 AND created_at>=? ORDER BY created_at').all(earliest)
  for (const event of events) {
    const bucket = byDay.get(dateKey(new Date(event.created_at)))
    if (!bucket) continue
    bucket.attempts += 1; bucket.correct += Number(event.similarity || 0) >= .92 ? 1 : 0; bucket.words.add(Number(event.word_id))
  }
  const result = keys.map(key => { const row = byDay.get(key); return { date: key, attempts: row.attempts, correct: row.correct, uniqueWords: row.words.size, successRate: row.attempts ? Math.round(row.correct / row.attempts * 1000) / 10 : null } })
  const totals = result.reduce((sum, row) => ({ attempts: sum.attempts + row.attempts, correct: sum.correct + row.correct, uniqueWordDays: sum.uniqueWordDays + row.uniqueWords }), { attempts: 0, correct: 0, uniqueWordDays: 0 })
  return { days, timeZone, series: result, totals: { ...totals, successRate: totals.attempts ? Math.round(totals.correct / totals.attempts * 1000) / 10 : null } }
}

async function ollamaHealth() {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: controller.signal })
    if (!response.ok) return { online: false, embeddingAvailable: false, languageAvailable: false }
    const payload = await response.json(), names = (payload.models || []).map(model => clean(model.name || model.model).toLowerCase())
    const available = wanted => names.some(name => name === wanted.toLowerCase() || name.startsWith(`${wanted.toLowerCase()}:`))
    return { online: true, embeddingAvailable: available(config.embeddingModel), languageAvailable: available(config.chatModel) }
  } catch { return { online: false, embeddingAvailable: false, languageAvailable: false } }
  finally { clearTimeout(timer) }
}

async function backupDatabase() {
  const directory = join(DATA, 'backups'); await mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), target = join(directory, `word-studio-${stamp}.db`)
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  const files = (await readdir(directory)).filter(name => name.endsWith('.db')).sort().reverse()
  await Promise.all(files.slice(14).map(name => unlink(join(directory, name))))
  return target
}

async function serveStatic(path, res) {
  const relative = path === '/' ? 'index.html' : path.slice(1), safe = normalize(relative).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, safe)
  if (!file.startsWith(DIST)) return json(res, 404, { error: 'Not found' })
  if (!existsSync(file) && !extname(safe)) file = join(DIST, 'index.html')
  if (!existsSync(file)) return json(res, 503, { error: 'Frontend is not built. Run npm run build.' })
  const data = await readFile(file), extension = extname(file)
  res.writeHead(200, { 'content-type': TYPES[extension] || 'application/octet-stream', 'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" })
  res.end(data)
}

async function handleAuth(req, res, path) {
  if (path === '/api/auth/session' && req.method === 'GET') {
    const session = activeSession(req), setupRequired = !setting(db, 'admin_password_hash')
    return json(res, 200, session ? { authenticated: true, csrfToken: session.csrf_token, expiresAt: session.expires_at, username: appSettings().profile.name } : { authenticated: false, setupRequired, setupAllowed: setupRequired && loopback(req) })
  }
  if (path === '/api/auth/setup' && req.method === 'POST') {
    if (setting(db, 'admin_password_hash')) return json(res, 409, { error: 'Owner password is already configured' })
    if (!loopback(req) && clean(req.headers['x-setup-token']) !== clean(process.env.APP_SETUP_TOKEN)) return json(res, 403, { error: 'Initial setup is allowed only from the local computer' })
    const payload = await readJson(req)
    if (String(payload.password || '').length < 12) return json(res, 400, { error: 'Use at least 12 characters' })
    setSetting(db, 'admin_password_hash', await hashPassword(payload.password))
    return json(res, 201, createSession(req, res))
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    const ip = clientIp(req), state = throttleState(ip)
    if (state.blocked) return json(res, 429, { error: 'Too many attempts. Try again later.', retryAfter: state.retryAfter }, { 'retry-after': String(state.retryAfter) })
    const encoded = setting(db, 'admin_password_hash')
    if (!encoded) return json(res, 409, { error: 'Complete local owner setup first' })
    const payload = await readJson(req)
    if (!await verifyPassword(payload.password || '', encoded)) { recordLoginFailure(ip); return json(res, 401, { error: 'The password is incorrect' }) }
    clearThrottle(ip)
    return json(res, 200, createSession(req, res))
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const session = activeSession(req)
    if (session && csrfValid(req, session)) db.prepare('DELETE FROM sessions WHERE id=?').run(session.id)
    res.setHeader('set-cookie', clearSessionCookie(isSecure(req)))
    return json(res, 200, { ok: true })
  }
  return false
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`), path = url.pathname
    if (path === '/api/health') return json(res, 200, { ok: true, words: words.length, syncing, enriching, database: 'ok' })
    if (path.startsWith('/api/auth/')) { const handled = await handleAuth(req, res, path); if (handled !== false) return }
    if (path.startsWith('/api/')) {
      const session = activeSession(req)
      if (!session) return json(res, 401, { error: 'Authentication required' })
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !csrfValid(req, session)) return json(res, 403, { error: 'Invalid CSRF token' })
    }

    if (path === '/api/search' && req.method === 'GET') return json(res, 200, { results: rankSearch(words, url.searchParams.get('q'), Math.min(50, Number(url.searchParams.get('limit') || 20))) })
    if (path === '/api/translate-selection' && req.method === 'GET') {
      const word = longestSavedMatch(words, url.searchParams.get('text'))
      return word ? json(res, 200, { match: { id: word.id, term: word.term, persian: word.persian, definition: word.definition || '', phonetic: word.phonetic || '', sentence: word.sentence || '' } }) : json(res, 404, { error: 'No saved match' })
    }
    if (path === '/api/settings' && req.method === 'GET') return json(res, 200, appSettings())
    if (path === '/api/settings' && req.method === 'PATCH') return json(res, 200, updateAppSettings(await readJson(req)))
    if (path === '/api/progress' && req.method === 'GET') {
      const requestedDays = Number(url.searchParams.get('days') || 30), days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30
      const timeZone = clean(url.searchParams.get('tz') || 'UTC').slice(0, 80)
      try { new Intl.DateTimeFormat('en', { timeZone }).format() } catch { return json(res, 400, { error: 'Invalid time zone' }) }
      return json(res, 200, progressReport(days, timeZone))
    }
    if (path === '/api/words' && req.method === 'GET') {
      const q = clean(url.searchParams.get('q')), results = q ? rankSearch(words, q, Math.min(500, Number(url.searchParams.get('limit') || 100))) : words.slice(0, Math.min(5000, Number(url.searchParams.get('limit') || 5000)))
      return json(res, 200, { words: results, total: words.length })
    }
    if (path === '/api/session' && req.method === 'GET') {
      const ids = String(url.searchParams.get('ids') || '').split(',').map(Number).filter(Number.isInteger).filter((id, index, list) => id > 0 && list.indexOf(id) === index).slice(0, 25)
      const requested = ids.length ? ids.map(id => words.find(word => Number(word.id) === id)).filter(Boolean) : dueWords(db, Math.min(30, Number(url.searchParams.get('count') || 12)))
      const source = ids.length ? { type: 'cloud', centerId: ids[0], similarity: clean(url.searchParams.get('similarity') || 'hybrid') } : { type: 'adaptive' }
      return json(res, 200, { words: requested, modes: ['transcription', 'dictation-machine', 'cloze', 'dictogloss', 'sound-confusion', 'letter-tiles'], source })
    }
    if (path === '/api/review' && req.method === 'POST') {
      const payload = await readJson(req), word = words.find(item => Number(item.id) === Number(payload.wordId))
      if (!word) return json(res, 404, { error: 'Word not found' })
      const stamp = new Date(), old = db.prepare('SELECT * FROM reviews WHERE word_id=?').get(word.id)
      const alignment = answerAlignment(payload.expected || word.term, payload.answer || '')
      if (payload.skipped) {
        const due = skippedSchedule(stamp).toISOString()
        db.prepare(`INSERT INTO reviews(word_id,due_at,updated_at,skip_count) VALUES(?,?,?,1) ON CONFLICT(word_id) DO UPDATE SET due_at=excluded.due_at,updated_at=excluded.updated_at,skip_count=reviews.skip_count+1`).run(word.id, due, stamp.toISOString())
        db.prepare(`INSERT INTO practice_events(word_id,mode,answer,similarity,elapsed_ms,replay_count,hints_used,skipped,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(word.id, clean(payload.mode || 'transcription'), clean(payload.answer), alignment.similarity, Number(payload.elapsedMs || 0), Number(payload.replayCount || 0), Number(payload.hintsUsed || 0), 1, stamp.toISOString())
        refresh(); return json(res, 200, { ok: true, skipped: true, dueAt: due, accuracyChanged: false })
      }
      const rating = automaticRating({ expected: payload.expected || word.term, answer: payload.answer, elapsedMs: payload.elapsedMs, replayCount: payload.replayCount, hintsUsed: payload.hintsUsed, revealed: payload.revealed, override: payload.ratingOverride })
      const result = scheduleReview(old, rating, stamp), card = result.card, correct = alignment.similarity >= 0.92
      db.prepare(`INSERT INTO reviews(word_id,ease,interval_days,repetitions,lapses,due_at,last_quality,attempts,correct,updated_at,fsrs_state,fsrs_stability,fsrs_difficulty,fsrs_elapsed_days,fsrs_scheduled_days,fsrs_learning_steps,fsrs_last_review,skip_count)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET interval_days=excluded.interval_days,repetitions=excluded.repetitions,lapses=excluded.lapses,due_at=excluded.due_at,last_quality=excluded.last_quality,attempts=excluded.attempts,correct=excluded.correct,updated_at=excluded.updated_at,fsrs_state=excluded.fsrs_state,fsrs_stability=excluded.fsrs_stability,fsrs_difficulty=excluded.fsrs_difficulty,fsrs_elapsed_days=excluded.fsrs_elapsed_days,fsrs_scheduled_days=excluded.fsrs_scheduled_days,fsrs_learning_steps=excluded.fsrs_learning_steps,fsrs_last_review=excluded.fsrs_last_review`).run(word.id, old?.ease || 2.5, result.intervalDays, card.reps, card.lapses, card.due.toISOString(), rating, Number(old?.attempts || 0) + 1, Number(old?.correct || 0) + (correct ? 1 : 0), stamp.toISOString(), card.state, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.learning_steps, card.last_review?.toISOString() || stamp.toISOString(), Number(old?.skip_count || 0))
      db.prepare(`INSERT INTO practice_events(word_id,mode,answer,rating,similarity,elapsed_ms,replay_count,hints_used,skipped,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)`).run(word.id, clean(payload.mode || 'transcription'), clean(payload.answer), rating, alignment.similarity, Number(payload.elapsedMs || 0), Number(payload.replayCount || 0), Number(payload.hintsUsed || 0), stamp.toISOString())
      refresh(); return json(res, 200, { ok: true, rating, dueAt: card.due.toISOString(), intervalDays: result.intervalDays, alignment })
    }
    if (path.startsWith('/api/definition/') && req.method === 'GET') {
      const word = words.find(item => Number(item.id) === Number(path.split('/').pop()))
      return word ? json(res, 200, { id: word.id, term: word.term, definition: word.definition || `Used in context: ${word.sentence}`, phonetic: word.phonetic || '', partOfSpeech: word.part_of_speech || '', persian: word.persian, sentence: word.sentence, example: word.example_sentence, contrastNote: word.contrast_note }) : json(res, 404, { error: 'Word not found' })
    }
    if (path.startsWith('/api/similar/') && req.method === 'GET') {
      const id = Number(path.split('/').pop()), type = url.searchParams.get('type') || 'hybrid', limit = Math.min(40, Number(url.searchParams.get('limit') || 10)), word = words.find(item => Number(item.id) === id)
      if (!word) return json(res, 404, { error: 'Word not found' })
      const cached = db.prepare('SELECT matches_json,built_at FROM neighbor_cache WHERE word_id=? AND type=? AND model=?').get(id, type, config.embeddingModel)
      const matches = cached ? JSON.parse(cached.matches_json).slice(0, limit) : similarWords(word, words, features, type, limit)
      return json(res, 200, { type, matches, cached: Boolean(cached), builtAt: cached?.built_at || null })
    }
    if (path === '/api/sync/status' && req.method === 'GET') return json(res, 200, { syncing, nextRunAt, intervalHours: config.syncHours, deckConfigured: Boolean(config.deckId), total: words.length, last: db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() || null, enrichment: enrichmentStatus(db, config), coverage: enrichmentCoverage(), modelHealth: { ollamaUrl: config.ollamaUrl, enriching, ...await ollamaHealth() } })
    if (path === '/api/sync' && req.method === 'POST') return json(res, 200, await syncDeck())
    if (path === '/api/import' && req.method === 'POST') { const result = importCards(db, parseCsv(await readBody(req, 8_000_000))); refresh(); return json(res, 200, result) }
    if (path === '/api/enrichment/run' && req.method === 'POST') {
      if (enriching) return json(res, 202, { status: 'busy' })
      db.prepare("UPDATE enrichment_jobs SET status='pending',attempts=0,error=NULL,updated_at=? WHERE kind='definition' AND status='failed' AND attempts>=4").run(nowIso())
      startBackgroundEnrichment(); return json(res, 202, { status: 'started' })
    }
    if (path === '/api/embeddings/rebuild' && req.method === 'POST') { const result = await buildEmbeddings(db, config); refresh(); return json(res, 200, result) }
    if (path === '/api/neighbors/rebuild' && req.method === 'POST') return json(res, 200, rebuildNeighbors(db, config))
    if (path === '/api/backup' && req.method === 'POST') return json(res, 200, { ok: true, file: await backupDatabase() })
    if (path.startsWith('/api/')) return json(res, 404, { error: 'API route not found' })
    return serveStatic(path, res)
  } catch (error) {
    console.error(req.method, req.url, error)
    const status = error instanceof z.ZodError ? 400 : error.status || 500
    if (!res.headersSent) json(res, status, { error: status < 500 ? error.message : 'The server could not complete this request' })
    else res.end()
  }
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`English Word Studio http://localhost:${config.port}`)
  scheduleSync(process.env.DISABLE_STARTUP_SYNC === '1' ? fourHourDelay(config.syncHours) : 30_000)
  if (process.env.DISABLE_STARTUP_SYNC !== '1') setTimeout(() => syncDeck().catch(error => console.error('Startup DuoCards sync:', error.message)), 750).unref()
  if (process.env.DISABLE_BACKGROUND_ENRICHMENT !== '1') setTimeout(() => startBackgroundEnrichment(), 2500).unref()
})

setInterval(() => { db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(nowIso()) }, 3600000).unref()
setInterval(() => backupDatabase().catch(error => console.error('Automatic backup:', error.message)), 86400000).unref()

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearTimeout(syncTimer); clearTimeout(enrichmentTimer); server.close(() => { db.close(); process.exit(0) }) })
