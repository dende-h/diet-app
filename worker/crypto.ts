// 体重に関わる値を、DBに保存する前に暗号化する（AES-GCM）。
// 鍵は Worker のシークレット DATA_KEY（32バイトを base64 にしたもの）。DBの画面やSQLでは中身が読めない。
// 暗号文には「どのユーザーのどの項目か」を結び付けるので、別のユーザーや別の列に移しても復号できない。

const PREFIX = 'v1:'

export type Field =
  | 'weights.weight'
  | 'goals.start_weight'
  | 'goals.loss_kg'
  | 'feedbacks.content'
  | 'daily_reviews.content'

const keys = new Map<string, Promise<CryptoKey>>()

function importKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    const raw = fromBase64(secret)
    if (raw.length !== 32) throw new Error('DATA_KEY must be 32 random bytes encoded in base64')
    key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    keys.set(secret, key)
  }
  return key
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** 暗号化済みの値か（暗号化を入れる前に保存された値は数値や平文のまま） */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/** 1ユーザー分の暗号化・復号 */
export class Cipher {
  private readonly key: CryptoKey
  private readonly userId: string

  private constructor(key: CryptoKey, userId: string) {
    this.key = key
    this.userId = userId
  }

  /** 鍵がなければ失敗させる（平文で保存してしまわないように） */
  static async create(secret: string | undefined, userId: string): Promise<Cipher> {
    if (!secret) throw new Error('DATA_KEY is not set')
    return new Cipher(await importKey(secret), userId)
  }

  private aad(field: Field): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(new TextEncoder().encode(`${this.userId}|${field}`))
  }

  async encrypt(text: string, field: Field): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.aad(field) },
      this.key,
      new TextEncoder().encode(text),
    )
    const out = new Uint8Array(iv.length + sealed.byteLength)
    out.set(iv)
    out.set(new Uint8Array(sealed), iv.length)
    return PREFIX + toBase64(out)
  }

  /** 暗号化前に保存された値（数値や平文）はそのまま返す */
  async decrypt(value: unknown, field: Field): Promise<string> {
    if (!isEncrypted(value)) return value == null ? '' : String(value)
    const bytes = fromBase64((value as string).slice(PREFIX.length))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: this.aad(field) },
      this.key,
      bytes.slice(12),
    )
    return new TextDecoder().decode(plain)
  }

  encryptNumber(n: number, field: Field): Promise<string> {
    return this.encrypt(String(n), field)
  }

  async decryptNumber(value: unknown, field: Field): Promise<number> {
    return Number(await this.decrypt(value, field))
  }
}
