import { useAuth } from '@clerk/react'
import { useState } from 'react'
import { clearPin, MAX_ATTEMPTS, savePin, verifyPin } from '../pin'
import { usePinLock } from './PinGate'
import { PinPad } from './PinPad'

type Flow = 'set' | 'change' | 'off'

export function PinCard() {
  const { userId } = useAuth()
  const { enabled, refresh } = usePinLock()
  const [flow, setFlow] = useState<Flow | null>(null)

  return (
    <section className="card">
      <div className="card-title">
        PINロック <span className={enabled ? 'badge ok' : 'badge'}>{enabled ? 'オン' : 'オフ'}</span>
      </div>
      <p className="muted small">
        アプリを開くときに4桁のPINを聞きます。ほかのアプリに切り替えて1分以上たってから戻ったときも聞きます。PINはこの端末だけに保存されます。
      </p>
      <div className="form-actions pin-actions">
        {enabled ? (
          <>
            <button className="button secondary" onClick={() => setFlow('change')}>
              PINを変更
            </button>
            <button className="link-button" onClick={() => setFlow('off')}>
              オフにする
            </button>
          </>
        ) : (
          <button className="button" onClick={() => setFlow('set')}>
            PINを設定
          </button>
        )}
      </div>
      {flow && userId && (
        <PinFlow
          flow={flow}
          userId={userId}
          onDone={() => {
            setFlow(null)
            refresh()
          }}
          onCancel={() => setFlow(null)}
        />
      )}
    </section>
  )
}

type Step = 'current' | 'new' | 'confirm'

const TITLES: Record<Step, string> = {
  current: '今のPINを入力',
  new: '新しいPIN（4桁）',
  confirm: 'もう一度入力してください',
}

/** PINの設定・変更・解除。変更と解除のときは今のPINを確認する */
function PinFlow({ flow, userId, onDone, onCancel }: { flow: Flow; userId: string; onDone: () => void; onCancel: () => void }) {
  const { signOut } = useAuth()
  const [step, setStep] = useState<Step>(flow === 'set' ? 'new' : 'current')
  const [first, setFirst] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)

  const go = (next: Step, msg = '') => {
    setStep(next)
    setMessage(msg)
    setAttempt((a) => a + 1)
  }

  const complete = async (pin: string) => {
    setBusy(true)
    try {
      if (step === 'current') {
        const result = await verifyPin(userId, pin)
        if (!result.ok) {
          if (result.remaining === 0) {
            alert(`PINを${MAX_ATTEMPTS}回まちがえたので、ログアウトします。メールアドレスで再ログインしてください。`)
            clearPin(userId)
            await signOut()
            return
          }
          go('current', `PINが違います（あと${result.remaining}回まちがえるとログアウト）`)
        } else if (flow === 'off') {
          clearPin(userId)
          onDone()
        } else {
          go('new')
        }
      } else if (step === 'new') {
        setFirst(pin)
        go('confirm')
      } else if (pin !== first) {
        setFirst('')
        go('new', 'PINが一致しませんでした。最初から入力してください')
      } else {
        await savePin(userId, pin)
        onDone()
      }
    } catch {
      go(step, '保存できませんでした。もう一度お試しください')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pin-overlay" role="dialog" aria-modal="true" aria-label="PINの設定">
      <PinPad
        key={attempt}
        title={TITLES[step]}
        message={message}
        error={message !== ''}
        busy={busy}
        onComplete={(pin) => void complete(pin)}
        footer={
          <button className="link-button" onClick={onCancel}>
            キャンセル
          </button>
        }
      />
    </div>
  )
}
