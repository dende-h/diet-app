import { useAuth } from '@clerk/react'
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { APP_NAME } from '../lib'
import { clearPin, hasPin, MAX_ATTEMPTS, verifyPin } from '../pin'
import { PinPad } from './PinPad'

/** ほかのアプリに切り替えてから、これ以上たって戻ったらもう一度PINを聞く */
const LOCK_AFTER_MS = 60_000

interface PinLock {
  enabled: boolean
  /** 設定画面でPINを変えたあとに呼ぶ */
  refresh: () => void
}

const PinContext = createContext<PinLock | null>(null)

export function usePinLock(): PinLock {
  const value = use(PinContext)
  if (!value) throw new Error('usePinLock must be used inside PinGate')
  return value
}

/**
 * PINが設定されていれば、アプリを開いたときと、しばらくほかのアプリを使って戻ってきたときにPINを聞く。
 * ロック中は中身を描画しない（データの読み込みもしない）。
 */
export function PinGate({ children }: { children: ReactNode }) {
  const { userId, signOut } = useAuth()
  const [enabled, setEnabled] = useState(() => (userId ? hasPin(userId) : false))
  const [locked, setLocked] = useState(enabled)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const since = hiddenAt.current
      hiddenAt.current = null
      if (since !== null && Date.now() - since >= LOCK_AFTER_MS && userId && hasPin(userId)) setLocked(true)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [userId])

  const value = useMemo<PinLock>(
    () => ({ enabled, refresh: () => setEnabled(userId ? hasPin(userId) : false) }),
    [enabled, userId],
  )

  if (locked && userId) {
    return (
      <LockScreen
        userId={userId}
        onUnlock={() => setLocked(false)}
        onReset={async () => {
          clearPin(userId)
          await signOut()
        }}
      />
    )
  }
  return <PinContext value={value}>{children}</PinContext>
}

function LockScreen({ userId, onUnlock, onReset }: { userId: string; onUnlock: () => void; onReset: () => Promise<void> }) {
  const [attempt, setAttempt] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const check = async (pin: string) => {
    setBusy(true)
    try {
      const result = await verifyPin(userId, pin)
      if (result.ok) {
        onUnlock()
        return
      }
      if (result.remaining === 0) {
        alert(`PINを${MAX_ATTEMPTS}回まちがえたので、ログアウトします。メールアドレスで再ログインしてください。`)
        await onReset()
        return
      }
      setMessage(`PINが違います（あと${result.remaining}回まちがえるとログアウト）`)
    } catch {
      setMessage('PINを確認できませんでした')
    } finally {
      setBusy(false)
    }
    setAttempt((a) => a + 1)
  }

  return (
    <main className="pin-screen">
      <p className="brand">{APP_NAME}</p>
      <PinPad
        key={attempt}
        title="PINを入力"
        message={message}
        error={message !== ''}
        busy={busy}
        onComplete={(pin) => void check(pin)}
        footer={
          <button
            className="link-button"
            onClick={() => {
              if (confirm('ログアウトします。メールアドレスで再ログインすると、PINを設定し直せます。')) void onReset()
            }}
          >
            PINを忘れた場合
          </button>
        }
      />
    </main>
  )
}
