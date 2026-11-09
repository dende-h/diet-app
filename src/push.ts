// スマホへの通知（Web Push）の購読。購読は端末ごとで、送り先はサーバーに保存する
import type { Api } from './api'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

/** iPhone では、ホーム画面に追加したアプリからしか通知を許可できない */
export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok'
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  return ios && !standalone ? 'needs-install' : 'unsupported'
}

/** 通知の許可を断られた（端末の設定で許可し直す必要がある） */
export class PushDenied extends Error {}

/** Service Worker がない（開発中の画面など） */
export class NoServiceWorker extends Error {}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export function isPushOn(sub: PushSubscription | null): boolean {
  return Boolean(sub) && Notification.permission === 'granted'
}

function save(api: Api, sub: PushSubscription) {
  return api<void>('/push/subscriptions', { method: 'PUT', body: sub.toJSON() })
}

/** 通知をオンにする。ボタンを押した流れの中で呼ぶ（許可のダイアログはその時しか出せない） */
export async function subscribePush(api: Api): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new PushDenied()
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new NoServiceWorker()
  const { publicKey } = await api<{ publicKey: string }>('/push/key')
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) }))
  await save(api, sub)
}

export async function unsubscribePush(api: Api): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api<void>('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } })
  await sub.unsubscribe()
}

/**
 * アプリを開いたときに、この端末の購読をサーバーに送り直す。
 * ブラウザーが送り先を作り直したり、サーバー側で消えたりしていても通知が届き続けるように
 */
export async function syncPush(api: Api): Promise<void> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await save(api, sub)
}
