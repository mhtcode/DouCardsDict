import type { AppSettings, PracticeMode, ProgressReport, ReviewResult, SessionState, SimilarityType, SimilarWord, SyncStatus, Word } from './types'

let csrfToken = ''

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()) && csrfToken) headers.set('x-csrf-token', csrfToken)
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(payload.error || `Request failed (${response.status})`), { status: response.status, payload })
  return payload as T
}

export const api = {
  setCsrf(value?: string | null) { csrfToken = value || '' },
  async session() { const state = await request<SessionState>('/api/auth/session'); csrfToken = state.csrfToken || ''; return state },
  async login(password: string) { const state = await request<SessionState>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); csrfToken = state.csrfToken || ''; return state },
  async setup(password: string) { const state = await request<SessionState>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }); csrfToken = state.csrfToken || ''; return state },
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  words: (q = '', limit = 5000) => request<{ words: Word[]; total: number }>(`/api/words?q=${encodeURIComponent(q)}&limit=${limit}`),
  search: (q: string, limit = 12) => request<{ results: Word[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  translate: (text: string) => request<{ match: Word }>(`/api/translate-selection?text=${encodeURIComponent(text)}`),
  settings: () => request<AppSettings>('/api/settings'),
  updateSettings: (settings: Partial<AppSettings>) => request<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
  progress: (days: 7 | 30 | 90, timeZone: string) => request<ProgressReport>(`/api/progress?days=${days}&tz=${encodeURIComponent(timeZone)}`),
  practiceSession: (count = 12, ids: number[] = [], similarity: SimilarityType = 'hybrid') => request<{ words: Word[]; modes: PracticeMode[]; source: { type: 'adaptive' | 'cloud'; centerId?: number; similarity?: SimilarityType } }>(`/api/session?count=${count}${ids.length ? `&ids=${ids.join(',')}&similarity=${similarity}` : ''}`),
  review: (payload: Record<string, unknown>) => request<ReviewResult>('/api/review', { method: 'POST', body: JSON.stringify(payload) }),
  definition: (id: number) => request<Word>(`/api/definition/${id}`),
  similar: (id: number, type: SimilarityType, limit = 10) => request<{ type: SimilarityType; matches: SimilarWord[]; cached: boolean }>(`/api/similar/${id}?type=${type}&limit=${limit}`),
  syncStatus: () => request<SyncStatus>('/api/sync/status'),
  sync: () => request<Record<string, unknown>>('/api/sync', { method: 'POST' }),
  importCsv: (csv: string) => request<{ total: number; added: number; updated: number; unchanged: number }>('/api/import', { method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' }, body: csv }),
  enrich: () => request<{ status: string }>('/api/enrichment/run', { method: 'POST' }),
  backup: () => request<{ ok: boolean; file: string }>('/api/backup', { method: 'POST' }),
}
