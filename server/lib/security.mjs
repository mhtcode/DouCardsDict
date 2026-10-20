import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const COST = 2 ** 15

export const tokenHash = value => createHash('sha256').update(String(value)).digest('hex')

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url')
  const derived = await scrypt(String(password), salt, 64, { N: COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${COST}$8$1$${salt}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, expected] = String(encoded || '').split('$')
  if (algorithm !== 'scrypt' || !expected) return false
  const derived = await scrypt(String(password), salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  const expectedBuffer = Buffer.from(expected, 'base64url'), derivedBuffer = Buffer.from(derived)
  return expectedBuffer.length === derivedBuffer.length && timingSafeEqual(expectedBuffer, derivedBuffer)
}

export const createSessionSecrets = () => ({ token: randomBytes(32).toString('base64url'), csrf: randomBytes(24).toString('base64url') })
export const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(value => value.trim()).filter(Boolean).map(value => { const index = value.indexOf('='); return [decodeURIComponent(value.slice(0, index)), decodeURIComponent(value.slice(index + 1))] }))

export function sessionCookie(token, { secure = false, expires = new Date(Date.now() + 30 * 86400000) } = {}) {
  return [`ews_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', secure ? 'Secure' : '', `Expires=${expires.toUTCString()}`].filter(Boolean).join('; ')
}

export function clearSessionCookie(secure = false) {
  return [`ews_session=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', secure ? 'Secure' : '', 'Max-Age=0'].filter(Boolean).join('; ')
}
