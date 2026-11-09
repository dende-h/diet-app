import { describe, expect, it } from 'vitest'
import { encryptPayload, fromB64url, isPushEndpoint, loadVapid, toB64url, vapidToken } from './push'

// RFC 8291 Section 5 / Appendix A の例
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_' +
    'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/** 非圧縮の公開鍵（0x04 || x || y）と秘密鍵 d から JWK を作る */
function jwk(publicKey: string, d: string): JsonWebKey {
  const raw = fromB64url(publicKey)
  return { kty: 'EC', crv: 'P-256', x: toB64url(raw.slice(1, 33)), y: toB64url(raw.slice(33, 65)), d }
}

describe('encryptPayload', () => {
  it('matches the RFC 8291 example', async () => {
    const key = jwk(rfc.asPublic, rfc.asPrivate)
    const privateKey = await crypto.subtle.importKey('jwk', key, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const publicKey = await crypto.subtle.importKey('raw', fromB64url(rfc.asPublic), { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    const body = await encryptPayload(new TextEncoder().encode(rfc.plaintext), rfc.uaPublic, rfc.auth, {
      serverKeys: { privateKey, publicKey },
      salt: fromB64url(rfc.salt),
    })
    expect(toB64url(body)).toBe(rfc.body)
  })

  it('uses a fresh salt and key each time', async () => {
    const payload = new TextEncoder().encode('hi')
    const a = await encryptPayload(payload, rfc.uaPublic, rfc.auth)
    const b = await encryptPayload(payload, rfc.uaPublic, rfc.auth)
    expect(toB64url(a)).not.toBe(toB64url(b))
  })
})

describe('vapid', () => {
  it('signs a token that the public key verifies', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const secret = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
    const vapid = await loadVapid(secret)
    expect(toB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))).toBe(vapid.publicKey)

    const token = await vapidToken('https://web.push.apple.com/abc', vapid, 'https://example.test', 1_700_000_000_000)
    const [header, payload, signature] = token.split('.')
    expect(JSON.parse(new TextDecoder().decode(fromB64url(payload)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: 1_700_000_000 + 12 * 3600,
      sub: 'https://example.test',
    })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromB64url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    expect(ok).toBe(true)
  })

  it('rejects a key that is not P-256', async () => {
    await expect(loadVapid('{"kty":"RSA"}')).rejects.toThrow()
  })
})

describe('isPushEndpoint', () => {
  it('accepts push services only', () => {
    expect(isPushEndpoint('https://web.push.apple.com/QGz')).toBe(true)
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
    expect(isPushEndpoint('http://web.push.apple.com/x')).toBe(false)
    expect(isPushEndpoint('https://evil.example/web.push.apple.com')).toBe(false)
    expect(isPushEndpoint('https://web.push.apple.com.evil.example/x')).toBe(false)
    expect(isPushEndpoint(42)).toBe(false)
  })
})
