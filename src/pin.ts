// アプリを開くときのPIN。端末ごとの設定で、ログイン中のユーザーごとに localStorage に保存する。
// PINそのものは保存せず、PBKDF2 でハッシュ化した値だけを持つ。

export const PIN_LENGTH = 4
/** これだけ続けて間違えたらログアウトする（メールアドレスで再ログインすればPINを設定し直せる） */
export const MAX_ATTEMPTS = 5

const PREFIX = 'herulog:pin:'
const ITERATIONS = 150_000

interface StoredPin {
  salt: string
  hash: string
  iterations: number
  fails: number
}

function read(userId: string): StoredPin | null {
  try {
    const raw = localStorage.getItem(PREFIX + userId)
    return raw ? (JSON.parse(raw) as StoredPin) : null
  } catch {
    return null
  }
}

function write(userId: string, value: StoredPin) {
  localStorage.setItem(PREFIX + userId, JSON.stringify(value))
}

export function hasPin(userId: string): boolean {
  return read(userId) !== null
}

export function clearPin(userId: string) {
  try {
    localStorage.removeItem(PREFIX + userId)
  } catch {
    // 保存領域が使えないなら、そもそもPINも残っていない
  }
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return toBase64(new Uint8Array(bits))
}

export async function savePin(userId: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  write(userId, { salt: toBase64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS, fails: 0 })
}

export type VerifyResult = { ok: true } | { ok: false; remaining: number }

export async function verifyPin(userId: string, pin: string): Promise<VerifyResult> {
  const stored = read(userId)
  if (!stored) return { ok: true }
  const hash = await derive(pin, fromBase64(stored.salt), stored.iterations)
  if (hash === stored.hash) {
    if (stored.fails > 0) write(userId, { ...stored, fails: 0 })
    return { ok: true }
  }
  const fails = stored.fails + 1
  write(userId, { ...stored, fails })
  return { ok: false, remaining: Math.max(MAX_ATTEMPTS - fails, 0) }
}
