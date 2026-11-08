import { useEffect, useState, type ReactNode } from 'react'
import { PIN_LENGTH } from '../pin'

interface Props {
  title: string
  message?: string
  error?: boolean
  busy?: boolean
  /** 4桁そろったら呼ばれる。入力をやり直すときは呼び出し側で key を変えて作り直す */
  onComplete: (pin: string) => void
  footer?: ReactNode
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

/** スマホで押しやすい大きさの数字キーで、4桁のPINを入力する */
export function PinPad({ title, message, error, busy, onComplete, footer }: Props) {
  const [digits, setDigits] = useState('')
  const full = digits.length === PIN_LENGTH

  const press = (key: string) => {
    if (busy || full) return
    if (key === 'del') {
      setDigits((d) => d.slice(0, -1))
      return
    }
    const next = digits + key
    setDigits(next)
    if (next.length === PIN_LENGTH) onComplete(next)
  }

  // パソコンではキーボードでも入力できる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('del')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="pin">
      <h1 className="pin-title">{title}</h1>
      <p className={error ? 'pin-message error' : 'pin-message muted'} role={error ? 'alert' : undefined}>
        {message || ' '}
      </p>
      <div className={error ? 'pin-dots shake' : 'pin-dots'} aria-label={`${PIN_LENGTH}桁中${digits.length}桁入力済み`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < digits.length ? 'pin-dot filled' : 'pin-dot'} />
        ))}
      </div>
      <div className="pin-keys">
        {KEYS.map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={key === 'del' ? 'pin-key pin-key-del' : 'pin-key'}
              onClick={() => press(key)}
              disabled={busy}
              aria-label={key === 'del' ? '1文字消す' : key}
            >
              {key === 'del' ? '⌫' : key}
            </button>
          ),
        )}
      </div>
      {footer && <div className="pin-footer">{footer}</div>}
    </div>
  )
}
