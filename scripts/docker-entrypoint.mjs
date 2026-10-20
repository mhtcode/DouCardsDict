import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const configured = process.env.DATA_DIR || 'data'
const dataDirectory = isAbsolute(configured) ? configured : join(root, configured)
const database = join(dataDirectory, 'word-studio.db')
const seed = join(root, 'seed', 'word-studio.db')

await mkdir(dataDirectory, { recursive: true })
if (existsSync(seed) && !existsSync(database)) await copyFile(seed, database)
await import('../server.mjs')
