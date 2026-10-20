export type SimilarityType = 'hybrid' | 'semantic' | 'context' | 'pronunciation' | 'spelling' | 'morphology'
export type PracticeMode = 'transcription' | 'dictation-machine' | 'cloze' | 'dictogloss' | 'sound-confusion' | 'letter-tiles'

export interface AppSettings {
  profile: { name: string; email: string }
  speech: { accent: 'en-GB' | 'en-US' | 'en-CA' | 'en-AU'; voiceName: string; rate: number; pitch: number; autoPlayPrompt: boolean }
  practice: { autoAdvanceCorrect: boolean; correctDelayMs: number; autoAdvanceIncorrect: boolean; incorrectDelayMs: number }
}

export interface ProgressDay { date: string; attempts: number; correct: number; uniqueWords: number; successRate: number | null }
export interface ProgressReport { days: 7 | 30 | 90; timeZone: string; series: ProgressDay[]; totals: { attempts: number; correct: number; uniqueWordDays: number; successRate: number | null } }

export interface Word {
  id: number
  term: string
  persian: string
  sentence: string
  definition?: string
  phonetic?: string
  part_of_speech?: string
  partOfSpeech?: string
  example_sentence?: string
  example?: string
  contrast_note?: string
  contrastNote?: string
  due_at?: string
  attempts?: number
  correct?: number
  searchScore?: number
}

export interface SimilarWord extends Word {
  score: number
  reason: string
  signals: Record<SimilarityType, number>
}

export interface SessionState {
  authenticated: boolean
  setupRequired?: boolean
  setupAllowed?: boolean
  csrfToken?: string | null
  expiresAt?: string
  username?: string
}

export interface AlignmentOperation { expected: string; actual: string; type: 'equal' | 'replace' | 'missing' | 'extra' }
export interface ReviewResult { ok: boolean; rating?: number; skipped?: boolean; dueAt: string; intervalDays?: number; alignment?: { similarity: number; distance: number; operations: AlignmentOperation[] } }

export interface SyncStatus {
  syncing: boolean
  nextRunAt: string | null
  intervalHours: number
  deckConfigured: boolean
  total: number
  last: null | { status: string; finished_at?: string; added: number; updated: number; unchanged: number; message?: string }
  enrichment: { embeddings: { status: string; count: number }[]; jobs: { kind: string; status: string; count: number }[]; models: { embedding: string; language: string } }
  coverage: {
    embeddings: { complete: number; total: number; stale: number; dimension: number; model: string }
    definitions: { complete: number; total: number; pending: number; failed: number; running: number }
    neighbors: { completeWords: number; totalWords: number; types: { type: SimilarityType; count: number }[] }
    worker: { active: boolean; nextBatchAt: string | null }
  }
  modelHealth: { ollamaUrl: string; enriching: boolean; online: boolean; embeddingAvailable: boolean; languageAvailable: boolean }
}
