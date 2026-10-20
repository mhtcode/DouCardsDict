import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const relativeData = `data/http-test-${randomUUID()}`
const password = 'integration-owner-password'
let child, origin, childOutput = ''

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
})

async function waitForServer() {
  let lastFailure = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child?.exitCode !== null) throw new Error(`Integration server exited with code ${child.exitCode}:\n${childOutput}`)
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
      lastFailure = `HTTP ${response.status}`
    } catch (error) { lastFailure = [error.stack || error.message, error.cause?.stack || error.cause?.message].filter(Boolean).join('\nCaused by: ') }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Integration server did not become ready (${lastFailure}):\n${childOutput}`)
}

beforeAll(async () => {
  const port = await freePort()
  origin = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: relativeData, APP_PASSWORD: password, DUOCARDS_DECK_ID: '', DISABLE_STARTUP_SYNC: '1', DISABLE_BACKGROUND_ENRICHMENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => { childOutput += chunk })
  child.stderr.on('data', chunk => { childOutput += chunk })
  child.on('error', error => { childOutput += error.stack || error.message })
  await waitForServer()
}, 20_000)

afterAll(async () => {
  if (child && !child.killed) child.kill()
  await new Promise(resolve => setTimeout(resolve, 150))
  rmSync(join(root, relativeData), { recursive: true, force: true })
})

describe('HTTP authentication, CSRF and session lifecycle', () => {
  it('rejects unauthenticated API calls and bad credentials', async () => {
    expect((await fetch(`${origin}/api/words`)).status).toBe(401)
    const bad = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'incorrect password' }) })
    expect(bad.status).toBe(401)
  })

  it('creates a secure server session, enforces CSRF and invalidates logout', async () => {
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    expect(login.status).toBe(200)
    const session = await login.json(), setCookie = login.headers.get('set-cookie')
    expect(session.authenticated).toBe(true)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    const cookie = setCookie.split(';')[0]

    const blocked = await fetch(`${origin}/api/backup`, { method: 'POST', headers: { cookie } })
    expect(blocked.status).toBe(403)
    const allowed = await fetch(`${origin}/api/backup`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrfToken } })
    expect(allowed.status).toBe(200)

    const settingsResponse = await fetch(`${origin}/api/settings`, { method: 'PATCH', headers: { cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: 'Test Owner', email: 'owner@example.com' }, speech: { accent: 'en-CA' }, practice: { autoAdvanceIncorrect: true, incorrectDelayMs: 6000 } }) })
    expect(settingsResponse.status).toBe(200)
    expect(await settingsResponse.json()).toMatchObject({ profile: { name: 'Test Owner', email: 'owner@example.com' }, speech: { accent: 'en-CA' }, practice: { autoAdvanceIncorrect: true, incorrectDelayMs: 6000 } })
    const invalidSettings = await fetch(`${origin}/api/settings`, { method: 'PATCH', headers: { cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { email: 'not-an-email' } }) })
    expect(invalidSettings.status).toBe(400)

    const collection = await (await fetch(`${origin}/api/words?limit=2`, { headers: { cookie } })).json()
    const [first, second] = collection.words
    const cloudSession = await (await fetch(`${origin}/api/session?ids=${second.id},${first.id},${second.id}&similarity=spelling`, { headers: { cookie } })).json()
    expect(cloudSession.words.map(word => word.id)).toEqual([second.id, first.id])
    expect(cloudSession.source).toMatchObject({ type: 'cloud', centerId: second.id, similarity: 'spelling' })
    const review = await fetch(`${origin}/api/review`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ wordId: first.id, mode: 'transcription', expected: first.term, answer: first.term, elapsedMs: 1200, replayCount: 0, hintsUsed: 0 }) })
    expect(review.status).toBe(200)
    const progress = await (await fetch(`${origin}/api/progress?days=7&tz=UTC`, { headers: { cookie } })).json()
    expect(progress.series).toHaveLength(7)
    expect(progress.totals).toMatchObject({ attempts: 1, correct: 1, successRate: 100 })

    const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrfToken } })
    expect(logout.status).toBe(200)
    expect((await fetch(`${origin}/api/words`, { headers: { cookie } })).status).toBe(401)
  })
})
