import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../server/lib/database.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)), data = join(ROOT, process.env.DATA_DIR || 'data'), directory = join(data, 'backups')
await mkdir(directory, { recursive: true })
const db = openDatabase(join(data, 'word-studio.db')), stamp = new Date().toISOString().replace(/[:.]/g, '-'), target = join(directory, `word-studio-${stamp}.db`)
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); db.close()
const files = (await readdir(directory)).filter(name => name.endsWith('.db')).sort().reverse()
await Promise.all(files.slice(14).map(name => unlink(join(directory, name))))
console.log(target)
