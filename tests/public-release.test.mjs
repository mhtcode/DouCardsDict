import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

describe('public release packaging', () => {
  it('keeps personal learning data out of Git and Docker contexts', async () => {
    const gitignore = await readFile(join(root, '.gitignore'), 'utf8')
    const dockerignore = await readFile(join(root, '.dockerignore'), 'utf8')

    expect(gitignore).toMatch(/^data\/$/m)
    expect(gitignore).toMatch(/^vocabulary\.json$/m)
    expect(gitignore).not.toMatch(/^!data\/word-studio\.db$/m)
    expect(dockerignore).toMatch(/^data\/$/m)
    expect(dockerignore).toMatch(/^vocabulary\.json$/m)
  })

  it('builds and boots without a private seed database', async () => {
    const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8')
    const entrypoint = await readFile(join(root, 'scripts', 'docker-entrypoint.mjs'), 'utf8')

    expect(dockerfile).not.toContain('vocabulary.json')
    expect(dockerfile).not.toContain('data/word-studio.db')
    expect(entrypoint).toContain('existsSync(seed)')
    expect(entrypoint).toContain('existsSync(seed) && !existsSync(database)')
  })
})
