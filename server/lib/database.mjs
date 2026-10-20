import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { clean, contentHash, normalizeEnglish } from './text.mjs'

export const nowIso = () => new Date().toISOString()

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0]
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS words(
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      term TEXT NOT NULL,
      persian TEXT NOT NULL DEFAULT '',
      sentence TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      definition TEXT,
      phonetic TEXT,
      part_of_speech TEXT,
      embedding TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews(
      word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at TEXT,
      last_quality INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_runs(
      id INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      unchanged INTEGER NOT NULL DEFAULT 0,
      enrichment_queued INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_hash TEXT NOT NULL,
      csrf_token TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS login_throttle(
      ip TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS embeddings(
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimension INTEGER,
      vector BLOB,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      built_at TEXT,
      PRIMARY KEY(word_id, model)
    );
    CREATE TABLE IF NOT EXISTS neighbor_cache(
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      matches_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      built_at TEXT NOT NULL,
      PRIMARY KEY(word_id, type, model)
    );
    CREATE TABLE IF NOT EXISTS enrichment_jobs(
      id INTEGER PRIMARY KEY,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(word_id, kind, content_hash)
    );
    CREATE TABLE IF NOT EXISTS practice_events(
      id INTEGER PRIMARY KEY,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      rating INTEGER,
      similarity REAL,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      replay_count INTEGER NOT NULL DEFAULT 0,
      hints_used INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `)

  addColumn(db, 'words', "content_hash TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'words', "example_sentence TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'words', "contrast_note TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'words', "enrichment_status TEXT NOT NULL DEFAULT 'pending'")
  addColumn(db, 'reviews', 'fsrs_state INTEGER')
  addColumn(db, 'reviews', 'fsrs_stability REAL')
  addColumn(db, 'reviews', 'fsrs_difficulty REAL')
  addColumn(db, 'reviews', 'fsrs_elapsed_days INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'reviews', 'fsrs_scheduled_days INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'reviews', 'fsrs_learning_steps INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'reviews', 'fsrs_last_review TEXT')
  addColumn(db, 'reviews', 'skip_count INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'sessions', 'csrf_token TEXT')
  addColumn(db, 'sync_runs', 'unchanged INTEGER NOT NULL DEFAULT 0')
  addColumn(db, 'sync_runs', 'enrichment_queued INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_words_published_at ON words(published_at) WHERE published_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_words_term ON words(term COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_reviews_due_at ON reviews(due_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_kind ON enrichment_jobs(status, kind, updated_at);
    CREATE INDEX IF NOT EXISTS idx_events_word_created ON practice_events(word_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at DESC);
  `)

  const missingHashes = db.prepare("SELECT id,term,persian,sentence FROM words WHERE content_hash='' OR content_hash IS NULL").all()
  const updateHash = db.prepare('UPDATE words SET content_hash=? WHERE id=?')
  db.exec('BEGIN')
  try { missingHashes.forEach(word => updateHash.run(contentHash(word.term, word.persian, word.sentence), word.id)); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
  db.exec(`UPDATE reviews SET
    fsrs_state=CASE WHEN repetitions>0 THEN 2 WHEN lapses>0 THEN 3 ELSE 1 END,
    fsrs_stability=MAX(0.1,interval_days),
    fsrs_difficulty=MIN(10,MAX(1,6.2-ease)),
    fsrs_scheduled_days=ROUND(interval_days),
    fsrs_last_review=COALESCE(fsrs_last_review,updated_at)
    WHERE fsrs_state IS NULL`)
  db.exec('PRAGMA optimize')
  return db
}

export function setting(db, key) { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null }
export function setSetting(db, key, value) { db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, String(value), nowIso()) }

export function listWords(db) {
  return db.prepare(`SELECT w.id,w.source_key,w.term,w.persian,w.sentence,w.published_at,w.definition,w.phonetic,w.part_of_speech,w.content_hash,w.example_sentence,w.contrast_note,w.enrichment_status,w.created_at,w.updated_at,
    r.due_at,r.interval_days,r.repetitions,r.lapses,r.attempts,r.correct,r.skip_count,r.fsrs_state,r.fsrs_stability,r.fsrs_difficulty
    FROM words w LEFT JOIN reviews r ON r.word_id=w.id ORDER BY w.id`).all()
}

function queueWordJobs(db, wordId, hash, stamp) {
  const enqueue = db.prepare(`INSERT INTO enrichment_jobs(word_id,kind,content_hash,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(word_id,kind,content_hash) DO UPDATE SET status=CASE WHEN enrichment_jobs.status='complete' THEN 'complete' ELSE 'pending' END,updated_at=excluded.updated_at`)
  for (const kind of ['definition', 'embedding', 'neighbors']) enqueue.run(wordId, kind, hash, stamp, stamp)
  db.prepare("UPDATE words SET enrichment_status='pending' WHERE id=?").run(wordId)
}

export function importCards(db, cards) {
  const uniqueCards = new Map()
  for (const card of cards) {
    const term = clean(card.front || card.term), sentence = clean(card.hint || card.sentence)
    if (!term) continue
    const identity = `${term.toLowerCase()}\u241f${sentence.toLowerCase()}`, previous = uniqueCards.get(identity)
    const published = clean(card.publishedAt || card.published_at)
    const previousPublished = clean(previous?.publishedAt || previous?.published_at)
    if (!previous || published > previousPublished) uniqueCards.set(identity, card)
  }
  const byPublished = db.prepare('SELECT * FROM words WHERE published_at=?')
  const byIdentity = db.prepare('SELECT * FROM words WHERE lower(trim(term))=? AND lower(trim(sentence))=? ORDER BY id LIMIT 1')
  const insert = db.prepare(`INSERT INTO words(source_key,term,persian,sentence,published_at,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id`)
  const update = db.prepare(`UPDATE words SET term=?,persian=?,sentence=?,published_at=COALESCE(?,published_at),content_hash=?,updated_at=? WHERE id=?`)
  let added = 0, updated = 0, unchanged = 0, queued = 0
  db.exec('BEGIN')
  try {
    for (const card of uniqueCards.values()) {
      const term = clean(card.front || card.term), persian = clean(card.back || card.persian), sentence = clean(card.hint || card.sentence), published = clean(card.publishedAt || card.published_at) || null
      if (!term) continue
      const hash = contentHash(term, persian, sentence), stamp = nowIso()
      const existing = (published && byPublished.get(published)) || byIdentity.get(term.toLowerCase(), sentence.toLowerCase())
      if (!existing) {
        const sourceKey = published ? `duocards:${published}` : `${normalizeEnglish(term)}|${normalizeEnglish(sentence)}`
        const row = insert.get(sourceKey, term, persian, sentence, published, hash, stamp, stamp)
        queueWordJobs(db, row.id, hash, stamp); added += 1; queued += 3
      } else if (existing.content_hash !== hash || existing.term !== term || existing.persian !== persian || existing.sentence !== sentence) {
        update.run(term, persian, sentence, published, hash, stamp, existing.id)
        db.prepare('DELETE FROM neighbor_cache WHERE word_id=?').run(existing.id)
        queueWordJobs(db, existing.id, hash, stamp); updated += 1; queued += 3
      } else unchanged += 1
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { total: added + updated + unchanged, added, updated, unchanged, enrichmentQueued: queued }
}

export function dueWords(db, count = 10) {
  return db.prepare(`SELECT w.id,w.term,w.persian,w.sentence,w.definition,w.phonetic,w.part_of_speech,w.example_sentence,w.contrast_note,r.due_at,r.attempts,r.correct
    FROM words w LEFT JOIN reviews r ON r.word_id=w.id
    ORDER BY CASE WHEN r.due_at IS NULL THEN 0 WHEN r.due_at<=? THEN 1 ELSE 2 END,COALESCE(r.due_at,''),RANDOM() LIMIT ?`).all(nowIso(), count)
}
