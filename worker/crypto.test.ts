import { describe, expect, it } from 'vitest'
import { Cipher, isEncrypted } from './crypto'

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)))
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)))

describe('Cipher', () => {
  it('round-trips numbers and text without exposing them', async () => {
    const c = await Cipher.create(KEY, 'user_a')
    const weight = await c.encryptNumber(60.4, 'weights.weight')
    expect(isEncrypted(weight)).toBe(true)
    expect(weight).not.toContain('60.4')
    expect(await c.decryptNumber(weight, 'weights.weight')).toBe(60.4)

    const text = await c.encrypt('今朝は60.4kgでした', 'feedbacks.content')
    expect(text).not.toContain('60.4')
    expect(await c.decrypt(text, 'feedbacks.content')).toBe('今朝は60.4kgでした')
  })

  it('uses a fresh IV so equal values look different', async () => {
    const c = await Cipher.create(KEY, 'user_a')
    expect(await c.encryptNumber(60, 'weights.weight')).not.toBe(await c.encryptNumber(60, 'weights.weight'))
  })

  it('cannot be read as another user, another field or with another key', async () => {
    const a = await Cipher.create(KEY, 'user_a')
    const sealed = await a.encryptNumber(60.4, 'weights.weight')
    await expect((await Cipher.create(KEY, 'user_b')).decrypt(sealed, 'weights.weight')).rejects.toThrow()
    await expect(a.decrypt(sealed, 'goals.start_weight')).rejects.toThrow()
    await expect((await Cipher.create(OTHER_KEY, 'user_a')).decrypt(sealed, 'weights.weight')).rejects.toThrow()
  })

  it('passes through values saved before encryption', async () => {
    const c = await Cipher.create(KEY, 'user_a')
    expect(await c.decryptNumber(61.2, 'weights.weight')).toBe(61.2)
    expect(await c.decrypt('plain text', 'feedbacks.content')).toBe('plain text')
    expect(await c.decrypt('', 'feedbacks.content')).toBe('')
  })

  it('refuses to run without a valid key', async () => {
    await expect(Cipher.create(undefined, 'user_a')).rejects.toThrow('DATA_KEY is not set')
    await expect(Cipher.create(btoa('short'), 'user_a')).rejects.toThrow()
  })
})
