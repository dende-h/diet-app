import { useState, type FormEvent } from 'react'
import {
  addDays,
  calorieTarget,
  computePlan,
  intakeTotal,
  slotLabel,
  toDayNum,
  WEIGHT_SLOTS,
  weightAsOf,
  type Plan,
  type WeightRecord,
  type WeightSlot,
} from '../../shared/calc'
import { formatDate, formatKcal, useSlotFeedbacks, type SlotFeedback } from '../lib'
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

      <CalorieCard date={date} border={target.border} maintenance={target.maintenance} total={intakeTotal(intakes, date)} />
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

const MEAL_LABELS = ['朝食', '昼食', '夕食', '間食']

function defaultLabel(): string {
  const h = new Date().getHours()
  if (h < 10) return '朝食'
  if (h < 15) return '昼食'
  if (h < 17) return '間食'
  return '夕食'
}

function CalorieCard({ date, border, maintenance, total }: { date: string; border: number; maintenance: number; total: number }) {
  const { data, addIntake, deleteIntake } = useStore()
  const entries = data!.intakes.filter((i) => i.date === date)
  const [label, setLabel] = useState(defaultLabel)
  const [kcal, setKcal] = useState('')
  const [busy, setBusy] = useState(false)
  const remaining = border - total
  const over = remaining < 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = Number(kcal)
    if (!Number.isFinite(value) || value <= 0) return
    setBusy(true)
    try {
      await addIntake(date, value, label)
      setKcal('')
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
              <span>{i.label || '食事'}</span>
              <span className="num">{formatKcal(i.kcal)} kcal</span>
              <button
                className="icon-button small"
                aria-label={`${i.label} ${i.kcal}kcal を削除`}
                onClick={() => {
                  if (confirm(`${i.label || '食事'} ${i.kcal} kcal を削除しますか？`)) void deleteIntake(i.id)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="intake-form" onSubmit={submit}>
        <div className="chips">
          {MEAL_LABELS.map((l) => (
            <button type="button" key={l} className={l === label ? 'chip active' : 'chip'} onClick={() => setLabel(l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="input-row">
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
          <button className="button" disabled={busy || !kcal}>
            追加
          </button>
        </div>
      </form>
    </section>
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
