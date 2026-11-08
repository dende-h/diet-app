import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  addDays,
  calorieTarget,
  computePlan,
  intakeTotal,
  localTime,
  MAX_EXERCISE_LENGTH,
  slotLabel,
  toDayNum,
  WEIGHT_SLOTS,
  weightAsOf,
  type CalorieEstimate,
  type Plan,
  type WeightRecord,
  type WeightSlot,
} from '../../shared/calc'
import { ApiError, useApi } from '../api'
import { formatDate, formatKcal, useSlotFeedbacks, type SlotFeedback } from '../lib'
import { photoToJpeg } from '../photo'
import { AlreadyRecorded, useStore } from '../store'

interface Props {
  date: string
  setDate: (date: string) => void
  today: string
}

export function Home({ date, setDate, today }: Props) {
  const { data, daily } = useStore()
  const { profile, goal, weights, intakes } = data!
  const weight = weightAsOf(daily, date, goal!.startWeight)
  const target = calorieTarget(profile!, weight, date)
  const plan = computePlan(goal!, daily, today)
  const records = weights.filter((w) => w.date === date)
  const recorded = WEIGHT_SLOTS.map((s) => s.value).filter((slot) => records.some((r) => r.slot === slot))
  const feedbacks = useSlotFeedbacks(date, recorded, date === today)

  return (
    <>
      <header className="date-nav">
        <button className="icon-button" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
          ‹
        </button>
        <h1>{date === today ? `今日 ${formatDate(date)}` : formatDate(date)}</h1>
        <button
          className="icon-button"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
          aria-label="次の日"
        >
          ›
        </button>
      </header>

      <WeightCard key={date} date={date} today={today} records={records} />
      {/* 新しい記録へのひとことを、体重のすぐ下に出す */}
      {[...recorded].reverse().map((slot) => (
        <FeedbackCard key={slot} slot={slot} feedback={feedbacks.get(slot)} onRetry={() => feedbacks.retry(slot)} />
      ))}

      <CalorieCard
        key={`calorie-${date}`}
        date={date}
        border={target.border}
        maintenance={target.maintenance}
        total={intakeTotal(intakes, date)}
      />
      <ExerciseCard key={`exercise-${date}`} date={date} today={today} />
      <WeekCard plan={plan} weight={weightAsOf(daily, today, goal!.startWeight)} />
    </>
  )
}

function FeedbackCard({
  slot,
  feedback,
  onRetry,
}: {
  slot: WeightSlot
  feedback: SlotFeedback | undefined
  onRetry: () => void
}) {
  if (!feedback) return null
  return (
    <section className="card feedback" aria-live="polite">
      <div className="card-title">{slotLabel(slot)}のひとこと</div>
      {feedback.status === 'loading' && <p className="muted">AIがフィードバックを書いています…</p>}
      {feedback.status === 'done' && <p className="feedback-text">{feedback.content}</p>}
      {feedback.status === 'error' && (
        <p className="muted">
          フィードバックを取得できませんでした。
          <button className="link-button" onClick={onRetry}>
            もう一度
          </button>
        </p>
      )}
    </section>
  )
}

type PhotoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; estimate: CalorieEstimate }
  | { status: 'error'; message: string }

function CalorieCard({ date, border, maintenance, total }: { date: string; border: number; maintenance: number; total: number }) {
  const { data, addIntake, deleteIntake } = useStore()
  const api = useApi()
  const entries = data!.intakes
    .filter((i) => i.date === date)
    .sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)
  const [time, setTime] = useState(localTime)
  const [timeEdited, setTimeEdited] = useState(false)
  const [kcal, setKcal] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<PhotoState>({ status: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)
  const remaining = border - total
  const over = remaining < 0

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 同じ写真を選び直せるように空にしておく
    e.target.value = ''
    if (!file) return
    if (!timeEdited) setTime(localTime())
    setPhoto({ status: 'loading' })
    try {
      const image = await photoToJpeg(file)
      const estimate = await api<CalorieEstimate>('/estimate', {
        method: 'POST',
        body: { image: image.data, mediaType: image.mediaType },
      })
      setKcal(String(estimate.kcal))
      setLabel(estimate.label)
      setPhoto({ status: 'done', estimate })
    } catch (err) {
      const known = err instanceof ApiError && [422, 429, 502].includes(err.status)
      setPhoto({ status: 'error', message: known ? (err as ApiError).message : 'カロリーを計算できませんでした' })
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = Math.round(Number(kcal))
    if (!Number.isFinite(value) || value <= 0 || !time) return
    setBusy(true)
    try {
      await addIntake({ date, time, kcal: value, label })
      setKcal('')
      setLabel('')
      setTime(localTime())
      setTimeEdited(false)
      setPhoto({ status: 'idle' })
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">摂取カロリー</div>
      <div className={over ? 'big over' : 'big ok'}>
        {over ? (
          <>
            <small>ボーダーを</small> {formatKcal(-remaining)}
            <small> kcal オーバー</small>
          </>
        ) : (
          <>
            <small>あと</small> {formatKcal(remaining)}
            <small> kcal</small>
          </>
        )}
      </div>
      <div className="meter" aria-hidden="true">
        <div className={over ? 'meter-fill over' : 'meter-fill'} style={{ width: `${Math.min(total / border, 1) * 100}%` }} />
      </div>
      <p className="muted small">
        摂取 {formatKcal(total)} / ボーダー {formatKcal(border)} kcal（維持 {formatKcal(maintenance)} kcal の75%）
      </p>

      {entries.length > 0 && (
        <ul className="entries">
          {entries.map((i) => (
            <li key={i.id}>
              <span className="num muted">{i.time || '—'}</span>
              <span className="entry-label">{i.label || '食事'}</span>
              <span className="num">{formatKcal(i.kcal)} kcal</span>
              <button
                className="icon-button small"
                aria-label={`${i.time} ${i.label || '食事'} ${i.kcal}kcal を削除`}
                onClick={() => {
                  if (confirm(`${i.time} ${i.label || '食事'} ${i.kcal} kcal を削除しますか？`)) void deleteIntake(i.id)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="intake-form" onSubmit={submit}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e)} />
        <button
          type="button"
          className="button secondary wide photo-button"
          onClick={() => fileRef.current?.click()}
          disabled={photo.status === 'loading'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          写真からカロリーを計算
        </button>
        {photo.status === 'loading' && <p className="muted small">AIがカロリーを計算しています…</p>}
        {photo.status === 'done' && (
          <p className="estimate small">
            {photo.estimate.items.map((item) => `${item.name} ${formatKcal(item.kcal)}`).join(' / ')} kcal
            <br />
            <span className="muted">AIの目安です。違っていたら数字を直してから追加してください。</span>
          </p>
        )}
        {photo.status === 'error' && <p className="warning small">{photo.message}</p>}
        <div className="input-row">
          <input
            className="time-input"
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              setTimeEdited(true)
            }}
            aria-label="食べた時刻"
            required
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="kcal"
            min={1}
            max={10000}
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            aria-label="摂取カロリー"
          />
          <button className="button" disabled={busy || !kcal || !time}>
            追加
          </button>
        </div>
      </form>
    </section>
  )
}

function ExerciseCard({ date, today }: { date: string; today: string }) {
  const { data, saveExercise } = useStore()
  const saved = data!.exercises.find((e) => e.date === date)?.text ?? ''
  const [text, setText] = useState(saved)
  const [busy, setBusy] = useState(false)
  const dirty = text.trim() !== saved

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await saveExercise(date, text.trim())
      setText(text.trim())
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-title">{date === today ? '今日の運動' : 'この日の運動'}</div>
      <textarea
        rows={2}
        maxLength={MAX_EXERCISE_LENGTH}
        placeholder="例: 30分ウォーキング、階段を使った"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="運動の内容"
      />
      <div className="form-actions">
        <button className="button" disabled={busy || !dirty}>
          保存
        </button>
        {!dirty && saved && <span className="muted small">保存済み</span>}
      </div>
      <p className="muted small">
        AIのひとことの参考にします（消費カロリーは計算しません）。夜の体重を記録する前に書いておくと、夜のひとことに反映されます。
      </p>
    </form>
  )
}

function WeightCard({ date, today, records }: { date: string; today: string; records: WeightRecord[] }) {
  const open = WEIGHT_SLOTS.some((s) => !records.some((r) => r.slot === s.value))
  return (
    <section className="card">
      <div className="card-title">体重</div>
      <div className="slots">
        {WEIGHT_SLOTS.map((s) => (
          <SlotRow key={s.value} date={date} slot={s.value} saved={records.find((r) => r.slot === s.value)?.weight} />
        ))}
      </div>
      {open && (
        <p className="muted small slot-note">
          朝・夜それぞれ1日1回、記録すると変更できません。
          {date === today ? '記録するとAIからひとことが届きます。' : '過去の日の記録にはAIのひとことはつきません。'}
        </p>
      )}
    </section>
  )
}

/** 記録の並び順（日付 → 朝 → 夜） */
function order(r: { date: string; slot: WeightSlot }): string {
  return `${r.date}:${r.slot === 'morning' ? 0 : 1}`
}

function SlotRow({ date, slot, saved }: { date: string; slot: WeightSlot; saved: number | undefined }) {
  const { data, recordWeight } = useStore()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const label = slotLabel(slot)

  if (saved !== undefined) {
    return (
      <div className="slot-row">
        <span className="slot-label">{label}</span>
        <span className="slot-value num">
          {saved.toFixed(1)}
          <small> kg</small>
        </span>
        <span className="slot-lock muted small">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          記録済み
        </span>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const w = Math.round(Number(value) * 10) / 10
    if (!Number.isFinite(w) || w < 20 || w > 300) {
      alert('20〜300 kg の範囲で入力してください')
      return
    }
    // 打ち間違いに気づけるよう、直前の記録から大きく離れていたら知らせる
    const here = order({ date, slot })
    const prev = data!.weights.filter((r) => order(r) < here).sort((a, b) => order(a).localeCompare(order(b))).at(-1)
    let message = `${label}の体重 ${w.toFixed(1)} kg を記録します。\n記録したあとは変更できません。`
    if (prev && Math.abs(w - prev.weight) >= 2) {
      const diff = w - prev.weight
      message =
        `前回（${formatDate(prev.date)} ${slotLabel(prev.slot)} ${prev.weight.toFixed(1)} kg）から ` +
        `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} kg です。入力に間違いはありませんか？\n\n${message}`
    }
    if (!confirm(message)) return
    setBusy(true)
    try {
      await recordWeight(date, slot, w)
    } catch (err) {
      alert(err instanceof AlreadyRecorded ? `${label}の体重はすでに記録されています` : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="slot-row" onSubmit={submit}>
      <span className="slot-label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        placeholder="例: 62.4"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`${label}の体重(kg)`}
      />
      <span className="unit">kg</span>
      <button className="button" disabled={busy || !value}>
        記録
      </button>
    </form>
  )
}

function WeekCard({ plan, weight }: { plan: Plan; weight: number }) {
  if (plan.phase === 'before') {
    return (
      <section className="card">
        <div className="card-title">今週の目標</div>
        <p className="muted">目標期間はまだ始まっていません。</p>
      </section>
    )
  }
  if (plan.phase === 'finished' || !plan.current) {
    return (
      <section className="card">
        <div className="card-title">今週の目標</div>
        <p className="muted">目標期間が終わりました。おつかれさまでした！ 設定から新しい目標を作れます。</p>
      </section>
    )
  }

  const w = plan.current
  const days = toDayNum(w.endDate) - toDayNum(w.startDate) + 1
  // 1週間あたり体重の1%を超える減量ペースは速すぎるとされる
  const fast = (w.targetLoss * 7) / days > weight * 0.01

  return (
    <section className="card">
      <div className="card-title">
        今週の目標 <span className="muted small">第{w.index + 1}週 / 全{Math.ceil(plan.totalWeeks)}週</span>
      </div>
      {w.targetLoss === 0 ? (
        <p className="big ok">
          <small>目標体重に到達！ キープしましょう</small>
        </p>
      ) : (
        <p className="big">
          −{w.targetLoss.toFixed(2)}
          <small> kg</small>
        </p>
      )}
      <p className="muted small">
        {formatDate(w.startDate)}〜{formatDate(w.endDate)}・週末の目標 {w.targetWeight.toFixed(1)} kg
        <br />
        当初の計画では週 −{plan.initialWeeklyLoss.toFixed(2)} kg。毎週の体重から残りを割り直しています。
      </p>
      {fast && <p className="warning small">ペースが速めです。無理をせず、期間の延長も検討してください。</p>}
    </section>
  )
}
