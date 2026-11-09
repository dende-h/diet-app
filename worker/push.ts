// スマホへの通知（Web Push, RFC 8030）。
// 送り主は VAPID（RFC 8292）の署名で示し、本文は端末の鍵で暗号化する（RFC 8291, aes128gcm）。
// 通知の本文には体重などの中身を入れない（Apple・Google の通知サーバーを通るため）。

const enc = new TextEncoder()

export function toB64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** 1レコードの大きさ。通知の本文は短いので1レコードに収まる */
const RECORD_SIZE = 4096

/**
 * 通知の本文を、端末の公開鍵（p256dh）と認証用の秘密（auth）で暗号化する（RFC 8291）。
 * serverKeys と salt はテストで決まった値を使うためのもので、ふだんは毎回作る。
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  opts: { serverKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(p256dh)
  const authSecret = fromB64url(auth)
  const keys =
    opts.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // Workers の型定義では `$public` になっているが、実行時（Web Crypto の仕様）は `public`
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0]
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, keys.privateKey, 256))

  // HKDF（出力が32バイト以下なので Expand は HMAC 1回）
  const prkKey = await hmac(authSecret, ecdhSecret)
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, [1]))
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 最後のレコードの区切りは 0x02
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, [2])))
  const rs = [(RECORD_SIZE >>> 24) & 0xff, (RECORD_SIZE >>> 16) & 0xff, (RECORD_SIZE >>> 8) & 0xff, RECORD_SIZE & 0xff]
  return concat(salt, rs, [asPublic.length], asPublic, sealed)
}

/** VAPID の鍵。秘密鍵は Worker のシークレット VAPID_PRIVATE_KEY（P-256 の JWK） */
export interface Vapid {
  privateKey: CryptoKey
  /** 端末に渡す公開鍵（非圧縮の点を base64url にしたもの） */
  publicKey: string
}

export async function loadVapid(secret: string): Promise<Vapid> {
  const jwk = JSON.parse(secret) as JsonWebKey
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error('VAPID_PRIVATE_KEY must be a P-256 private key in JWK format')
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  return { privateKey, publicKey: toB64url(concat([4], fromB64url(jwk.x), fromB64url(jwk.y))) }
}

/** 通知サーバーに送る、送り主を示すトークン（ES256 の JWT） */
export async function vapidToken(endpoint: string, vapid: Vapid, subject: string, now = Date.now()): Promise<string> {
  const part = (value: unknown) => toB64url(enc.encode(JSON.stringify(value)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, enc.encode(unsigned))
  return `${unsigned}.${toB64url(new Uint8Array(signature))}`
}

// 端末のブラウザーが発行する送り先は、各社の通知サーバーのURLに限る（任意のURLへ送らせないため）
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com']

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/** 端末で表示する通知の中身（public/sw.js が読む） */
export interface PushMessage {
  title: string
  body: string
  /** 通知を押したときに開く日付 */
  date?: string
}

/** 通知を1件送る。gone なら端末側で購読がなくなっているので、送り先を消してよい */
export async function sendPush(target: PushTarget, message: PushMessage, vapid: Vapid, subject: string) {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${await vapidToken(target.endpoint, vapid, subject)}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // 端末の電源が切れていても、翌朝までに届けばよい
      TTL: String(12 * 3600),
      Urgency: 'normal',
    },
    body,
  })
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 }
}
