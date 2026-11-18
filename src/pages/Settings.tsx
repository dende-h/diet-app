import { SignOutButton, useUser } from '@clerk/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ACTIVITY_LEVELS,
  addDays,
  localToday,
  LOG_REMINDER_HOUR,
  REVIEW_FALLBACK_HOUR,
  toDayNum,
  weightAsOf,
  type Sex,
} from '../../shared/calc'
import { ApiError, useApi } from '../api'
import {
  currentSubscription,
  isPushOn,
  NoServiceWorker,
  pushSupport,
  PushDenied,
  subscribePush,
  unsubscribePush,
} from '../push'
import { PinCard } from '../components/PinSettings'
import { formatDate } from '../lib'
import { useStore } from '../store'

export function Settings({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved: () => void }) {
  const { data } = useStore()
  return (
    <>
      <header className="page-header">
        <h1>{onboarding ? 'はじめに' : '設定'}</h1>
        {onboarding && <p className="muted">プロフィールと目標を登録すると使い始められます。</p>}
      </header>
      <ProfileForm />
      {(data!.profile || !onboarding) && <GoalForm onboarding={onboarding} onSaved={onSaved} />}
      {!onboarding && <NotificationCard />}
      {!onboarding && <PinCard />}
      <AccountCard />
    </>
  )
}

function ProfileForm() {
  const { data, saveProfile } = useStore()
  const p = data!.profile
  const [sex, setSex] = useState<Sex>(p?.sex ?? 'female')
  const [birthYear, setBirthYear] = useState(p ? String(p.birthYear) : '')
  const [heightCm, setHeightCm] = useState(p ? String(p.heightCm) : '')
  const [activity, setActivity] = useState<number>(p?.activity ?? ACTIVITY_LEVELS[0].value)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await saveProfile({ sex, birthYear: Number(birthYear), heightCm: Number(heightCm), activity })
      setMessage('保存しました')
    } catch (err) {
      setMessage(err instanceof ApiError ? `保存できませんでした（${err.message}）` : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-title">プロフィール</div>
      <p className="muted small">1日の維持カロリーの計算に使います。</p>
      <div className="field">
        <span className="label">性別</span>
        <div className="chips">
          {(['female', 'male'] as const).map((s) => (
            <button type="button" key={s} className={sex === s ? 'chip active' : 'chip'} onClick={() => setSex(s)}>
              {s === 'female' ? '女性' : '男性'}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">生まれた年</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="例: 1990"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          required
          min={1900}
          max={Number(localToday().slice(0, 4))}
        />
      </label>
      <label className="field">
        <span className="label">身長 (cm)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="例: 160"
          value={heightCm}
          onChange={(e) => setHeightCm(e.target.value)}
          required
          min={100}
          max={250}
        />
      </label>
      <label className="field">
        <span className="label">ふだんの活動量</span>
        <select value={activity} onChange={(e) => setActivity(Number(e.target.value))}>
          {ACTIVITY_LEVELS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="form-actions">
        <button className="button" disabled={busy}>
          保存
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    </form>
  )
}

const WEEK_PRESETS = [4, 8, 12, 16, 24]

function GoalForm({ onboarding, onSaved }: { onboarding: boolean; onSaved: () => void }) {
  const { data, daily, saveGoal } = useStore()
  const goal = data!.goal
  const today = localToday()
  const latest = daily.length > 0 ? weightAsOf(daily, today, 0) : 0
  const [editing, setEditing] = useState(!goal)
  const [startDate, setStartDate] = useState(today)
  const [startWeight, setStartWeight] = useState(latest ? latest.toFixed(1) : '')
  const [lossKg, setLossKg] = useState('')
  const [endDate, setEndDate] = useState(addDays(today, 7 * 12))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (goal && !editing) {
    const weeks = (toDayNum(goal.endDate) - toDayNum(goal.startDate)) / 7
    return (
      <section className="card">
        <div className="card-title">目標</div>
        <dl className="summary">
          <dt>期間</dt>
          <dd>
            {formatDate(goal.startDate)} 〜 {formatDate(goal.endDate)}（{weeks.toFixed(1)}週）
          </dd>
          <dt>体重</dt>
          <dd>
            {goal.startWeight.toFixed(1)} kg → {(goal.startWeight - goal.lossKg).toFixed(1)} kg（−{goal.lossKg.toFixed(1)}{' '}
            kg）
          </dd>
        </dl>
        <button className="button secondary" onClick={() => setEditing(true)}>
          目標を作り直す
        </button>
      </section>
    )
  }

  const sw = Number(startWeight)
  const loss = Number(lossKg)
  const weeks = (toDayNum(endDate) - toDayNum(startDate)) / 7
  const valid = sw > 0 && loss > 0 && loss < sw && weeks >= 1
  const weekly = valid ? loss / weeks : 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    if (goal && !confirm('今の目標を置き換えますか？（体重や食事の記録はそのまま残ります）')) return
    setBusy(true)
    setError('')
    try {
      await saveGoal({ startDate, endDate, startWeight: sw, lossKg: loss })
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? `保存できませんでした（${err.message}）` : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-title">目標</div>
      <label className="field">
        <span className="label">開始日</span>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </label>
      <label className="field">
        <span className="label">開始時の体重 (kg)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="例: 62.0"
          value={startWeight}
          onChange={(e) => setStartWeight(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span className="label">減らしたい体重 (kg)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="例: 5"
          value={lossKg}
          onChange={(e) => setLossKg(e.target.value)}
          required
        />
      </label>
      <div className="field">
        <span className="label">期間</span>
        <div className="chips">
          {WEEK_PRESETS.map((w) => (
            <button
              type="button"
              key={w}
              className={endDate === addDays(startDate, 7 * w) ? 'chip active' : 'chip'}
              onClick={() => setEndDate(addDays(startDate, 7 * w))}
            >
              {w}週
            </button>
          ))}
        </div>
        <input
          type="date"
          value={endDate}
          min={addDays(startDate, 7)}
          onChange={(e) => setEndDate(e.target.value)}
          aria-label="終了日"
          required
        />
      </div>
      {valid && (
        <p className="preview">
          {formatDate(endDate)}までに {(sw - loss).toFixed(1)} kg
          <br />
          <strong>週あたり −{weekly.toFixed(2)} kg</strong>（{weeks.toFixed(1)}週）
        </p>
      )}
      {valid && weekly > sw * 0.01 && (
        <p className="warning small">1週間に体重の1%を超えるペースです。期間を長めにするのがおすすめです。</p>
      )}
      {error && <p className="warning small">{error}</p>}
      <div className="form-actions">
        <button className="button" disabled={busy || !valid || !data!.profile}>
          {onboarding ? 'はじめる' : '保存'}
        </button>
        {goal && (
          <button type="button" className="button secondary" onClick={() => setEditing(false)}>
            キャンセル
          </button>
        )}
      </div>
    </form>
  )
}

function NotificationCard() {
  const api = useApi()
  const [support] = useState(pushSupport)
  const [on, setOn] = useState(false)
  /** 記録のリマインド（端末ごとではなく1人1件の設定）。読み込むまでは null */
  const [reminder, setReminder] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (support !== 'ok') return
    currentSubscription()
      .then((sub) => setOn(isPushOn(sub)))
      .catch(() => setOn(false))
  }, [support])

  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
  })
  useEffect(() => {
    apiRef
      .current<{ logReminder: boolean }>('/settings')
      .then((s) => setReminder(s.logReminder))
      .catch(() => setReminder(null))
  }, [])

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setMessage('')
    try {
      setMessage(await action())
    } catch (err) {
      if (err instanceof PushDenied) {
        setMessage('通知が許可されていません。端末の設定で、へるログの通知を許可してから、もう一度オンにしてください。')
      } else if (err instanceof NoServiceWorker) {
        setMessage('この画面では通知を使えません。')
      } else if (err instanceof ApiError && err.status === 503) {
        setMessage('通知の準備がまだできていません。')
      } else {
        setMessage('うまくいきませんでした。時間をおいてもう一度お試しください。')
      }
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () =>
    run(async () => {
      await subscribePush(api)
      setOn(true)
      return 'オンにしました。'
    })
  const turnOff = () =>
    run(async () => {
      await unsubscribePush(api)
      setOn(false)
      return 'オフにしました。'
    })
  const saveReminder = (value: boolean) =>
    run(async () => {
      const saved = await api<{ logReminder: boolean }>('/settings', { method: 'PUT', body: { logReminder: value } })
      setReminder(saved.logReminder)
      return saved.logReminder ? '記録のリマインドをオンにしました。' : '記録のリマインドをオフにしました。'
    })
  const test = () =>
    run(async () => {
      const res = await api<{ sent: number }>('/push/test', { method: 'POST' })
      return res.sent > 0 ? 'テスト通知を送りました。届くまで少しかかることがあります。' : '通知を送れませんでした。一度オフにして、もう一度オンにしてください。'
    })

  return (
    <section className="card">
      <div className="card-title">
        通知 <span className={on ? 'badge ok' : 'badge'}>{on ? 'オン' : 'オフ'}</span>
      </div>
      <p className="muted small">
        この端末に通知を送ります。通知には体重などの記録の中身は表示しません。
      </p>
      <ul className="muted small notice-list">
        <li>
          <strong>昨日の振り返り</strong>：朝の体重を記録しなかった日は、{REVIEW_FALLBACK_HOUR}
          時ごろにAIが昨日の振り返りを作って知らせます（体重を記録した日は、その場で今日の画面に出るので通知しません）。
        </li>
        <li>
          <strong>記録のリマインド</strong>：{LOG_REMINDER_HOUR}
          時に、その日の体重か食事がまだ記録されていなければ知らせます。通知をオンにすると、オン・オフを選べます（はじめはオフ）。
        </li>
      </ul>
      {support === 'needs-install' && (
        <p className="muted small">
          iPhoneでは、ホーム画面に追加したアプリから通知をオンにできます（Safariの共有ボタン →「ホーム画面に追加」）。
        </p>
      )}
      {support === 'unsupported' && <p className="muted small">この端末・ブラウザーでは通知を使えません。</p>}
      {support === 'ok' && (
        <div className="form-actions pin-actions">
          {on ? (
            <>
              <button className="button secondary" onClick={test} disabled={busy}>
                テスト通知を送る
              </button>
              <button className="link-button" onClick={turnOff} disabled={busy}>
                オフにする
              </button>
            </>
          ) : (
            <button className="button" onClick={turnOn} disabled={busy}>
              通知をオンにする
            </button>
          )}
        </div>
      )}
      {support === 'ok' && on && reminder !== null && (
        <div className="field reminder-field">
          <span className="label">記録のリマインド（{LOG_REMINDER_HOUR}時）</span>
          <div className="chips" role="group" aria-label="記録のリマインド">
            {([true, false] as const).map((value) => (
              <button
                type="button"
                key={String(value)}
                className={reminder === value ? 'chip active' : 'chip'}
                aria-pressed={reminder === value}
                disabled={busy}
                onClick={() => reminder !== value && saveReminder(value)}
              >
                {value ? 'オン' : 'オフ'}
              </button>
            ))}
          </div>
          <span className="muted small">通知をオンにしている、あなたのすべての端末に届きます。</span>
        </div>
      )}
      {message && (
        <p className="muted small" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  )
}

function AccountCard() {
  const { user } = useUser()
  return (
    <section className="card">
      <div className="card-title">アカウント</div>
      <p className="muted small">{user?.primaryEmailAddress?.emailAddress}</p>
      <SignOutButton>
        <button className="button secondary">ログアウト</button>
      </SignOutButton>
      <p className="muted small install-hint">
        iPhoneはSafariの共有ボタン →「ホーム画面に追加」、AndroidはChromeのメニュー →「ホーム画面に追加」でアプリとして使えます。
      </p>
    </section>
  )
}
