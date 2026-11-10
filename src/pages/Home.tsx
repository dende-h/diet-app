import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  addDays,
  calorieTarget,
  computePlan,
  DAILY_ESTIMATE_LIMIT,
  hasRecords,
  intakeTotal,
  localTime,
  localToday,
  MAX_EXERCISE_LENGTH,
  MAX_MEAL_LABEL_LENGTH,
  MAX_REVIEW_GENERATIONS,
  MAX_WEIGHINS_PER_DAY,
  mealLabel,
  compareRecords,
  toDayNum,
  weightAsOf,
  type CalorieEstimate,
  type CalorieTarget,
  type EstimateUsage,
  type Plan,
  type WeightRecord,
} from '../../shared/calc'
import { ApiError, useApi } from '../api'
import { TitleWithHelp } from '../components/Help'
import { CalorieHelp, ExerciseHelp, ReviewHelp, WeekHelp, WeightHelp } from '../components/HelpTexts'
import { formatDate, formatKcal, useDailyReview, useWeighInFeedbacks, type WeighInFeedback } from '../lib'
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
  const records = weights.filter((w) => w.date === date).sort(compareRecords)
  const yesterdayHasRecords = hasRecords(data!, addDays(date, -1))
  // 前の日に記録があれば、その日1回目の体重へのひとことの代わりに「昨日の振り返り」を書く
  const feedbacks = useWeighInFeedbacks(
    date,
    records.map((r) => r.seq).filter((seq) => !(yesterdayHasRecords && seq === 1)),
    date === today,
  )

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

      <ReviewCard
        key={`review-${date}`}
        date={date}
        today={today}
        dayHasRecords={yesterdayHasRecords}
        weighedIn={records.length > 0}
      />
      <WeightCard key={date} date={date} today={today} records={records} />
      {/* 新しい記録へのひとことを、体重のすぐ下に出す */}
      {[...records].reverse().map((r) => (
        <FeedbackCard key={r.seq} time={r.time} feedback={feedbacks.get(r.seq)} onRetry={() => feedbacks.retry(r.seq)} />
      ))}

      <CalorieCard
        key={`calorie-${date}`}
        date={date}
        target={target}
        activity={profile!.activity}
        total={intakeTotal(intakes, date)}
      />
      <ExerciseCard key={`exercise-${date}`} date={date} today={today} />
      <WeekCard plan={plan} weight={weightAsOf(daily, today, goal!.startWeight)} />
    </>
  )
}

function FeedbackCard({
  time,
  feedback,
  onRetry,
}: {
  time: string
  feedback: WeighInFeedback | undefined
  onRetry: () => void
}) {
  if (!feedback) return null
  return (
    <section className="card feedback" aria-live="polite">
      <div className="card-title">{time}のひとこと</div>
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

/**
 * 前の日を振り返る「昨日の振り返り」。今日の画面では、朝いちばんの体重を記録したときに自動で作る
 * （その日1回目の体重へのひとことの代わり）。体重を量らなかった日は、昼にサーバーが作って通知する。
 */
function ReviewCard({
  date,
  today,
  dayHasRecords,
  weighedIn,
}: {
  date: string
  today: string
  /** 振り返る日（前の日）に記録があるか */
  dayHasRecords: boolean
  /** この日に体重を記録したか */
  weighedIn: boolean
}) {
  const day = addDays(date, -1)
  const { review, loaded, writing, error, create } = useDailyReview(day)
  // 作ったり作り直したりできるのは今日の画面（＝昨日の分）だけ
  const live = date === today
  const canCreate = !review && live && dayHasRecords
  const left = review ? MAX_REVIEW_GENERATIONS - review.generations : 0

  const autoStarted = useRef(false)
  useEffect(() => {
    if (!loaded || !canCreate || !weighedIn || writing || error || autoStarted.current) return
    autoStarted.current = true
    void create()
  }, [loaded, canCreate, weighedIn, writing, error, create])

  if (!loaded || (!review && !writing && !canCreate && !error)) return null
  return (
    <section className="card feedback" aria-live="polite">
      <div className="card-title">
        <TitleWithHelp title={live ? '昨日の振り返り' : `${formatDate(day)}の振り返り`} help="昨日の振り返りについて">
          <ReviewHelp />
        </TitleWithHelp>
      </div>
      {review && <p className="feedback-text">{review.content}</p>}
      {writing && <p className="muted">AIが昨日の振り返りを書いています…</p>}
      {!writing && canCreate && !weighedIn && !error && (
        <p className="muted small">
          今朝の体重を記録すると、AIが昨日の振り返りを書きます。
          <button className="link-button" onClick={() => void create()}>
            体重なしで今すぐ作る
          </button>
        </p>
      )}
      {!writing && canCreate && (weighedIn || error) && (
        <button className="button secondary" onClick={() => void create()}>
          振り返りを作る
        </button>
      )}
      {!writing && review && live && left > 0 && (
        <p className="muted small">
          昨日の記録を足したときは
          <button
            className="link-button"
            onClick={() => {
              if (confirm(`今の記録で振り返りを作り直しますか？（作り直せるのはあと${left}回です）`)) void create()
            }}
          >
            作り直す
          </button>
        </p>
      )}
      {error && <p className="warning small">{error}</p>}
    </section>
  )
}

type PhotoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; estimate: CalorieEstimate }
  | { status: 'error'; message: string }

function CalorieCard({
  date,
  target,
  activity,
  total,
}: {
  date: string
  target: CalorieTarget
  activity: number
  total: number
}) {
  const { data, addIntake, deleteIntake } = useStore()
  const border = target.border
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
  /** 選んだ写真（AIに送る前の、縮めたJPEG） */
  const [image, setImage] = useState<{ data: string; mediaType: 'image/jpeg' } | null>(null)
  const [preparing, setPreparing] = useState(false)
  /** 写真判定の今日の残り回数（読み込み前は null） */
  const [photoLeft, setPhotoLeft] = useState<number | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const remaining = border - total
  const over = remaining < 0
  const busyPhoto = preparing || photo.status === 'loading'

  const refreshPhotoLeft = useCallback(async () => {
    try {
      const usage = await api<EstimateUsage>(`/estimates/${localToday()}`)
      setPhotoLeft(usage.remaining)
    } catch {
      // 残り回数が分からなくても、写真判定はサーバー側で上限を確かめる
    }
  }, [api])

  useEffect(() => {
    let cancelled = false
    api<EstimateUsage>(`/estimates/${localToday()}`)
      .then((usage) => {
        if (!cancelled) setPhotoLeft(usage.remaining)
      })
      .catch(() => {
        // 残り回数が分からなくても、写真判定はサーバー側で上限を確かめる
      })
    return () => {
      cancelled = true
    }
  }, [api])

  // 写真は選んだだけでは送らない。内容（補足）を書いてから「計算する」で送る
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 同じ写真を選び直せるように空にしておく
    e.target.value = ''
    if (!file) return
    if (!timeEdited) setTime(localTime())
    setPreparing(true)
    try {
      setImage(await photoToJpeg(file))
      setPhoto({ status: 'idle' })
    } catch {
      setPhoto({ status: 'error', message: '写真を読み込めませんでした' })
    } finally {
      setPreparing(false)
    }
  }

  const removeImage = () => {
    setImage(null)
    setPhoto({ status: 'idle' })
  }

  const estimate = async () => {
    if (!image) return
    // 内容の欄は写真の補足としてAIに渡す（計算し直すときは、直した料理名もここに入っている）
    const note = label.trim()
    setPhoto({ status: 'loading' })
    try {
      const estimate = await api<CalorieEstimate & { remaining: number }>('/estimate', {
        method: 'POST',
        // 回数は利用者の「今日」で数える（記録する日付とは別）
        body: { image: image.data, mediaType: image.mediaType, date: localToday(), note },
      })
      setKcal(String(estimate.kcal))
      setLabel(mealLabel(estimate, note))
      setPhoto({ status: 'done', estimate })
      setPhotoLeft(estimate.remaining)
    } catch (err) {
      const known = err instanceof ApiError && [422, 429, 502].includes(err.status)
      setPhoto({ status: 'error', message: known ? (err as ApiError).message : 'カロリーを計算できませんでした' })
      void refreshPhotoLeft()
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
      setImage(null)
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">
        <TitleWithHelp title="摂取カロリー" help="摂取カロリーについて">
          <CalorieHelp target={target} activity={activity} />
        </TitleWithHelp>
      </div>
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
        摂取 {formatKcal(total)} / ボーダー {formatKcal(border)} kcal
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
        {/* スマホでは capture つきの方がすぐ背面カメラを開く（撮った写真は端末に保存されない機種が多い） */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e)} />
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e)} />
        <div className="photo-buttons">
          <button
            type="button"
            className="button secondary photo-button"
            onClick={() => cameraRef.current?.click()}
            disabled={busyPhoto || photoLeft === 0}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            カメラで撮る
          </button>
          <button
            type="button"
            className="button secondary photo-button"
            onClick={() => libraryRef.current?.click()}
            disabled={busyPhoto || photoLeft === 0}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <circle cx="9.5" cy="10" r="1.5" />
              <path d="M4 17l5-4.5 4 3.5 2.5-2 4.5 4" />
            </svg>
            写真を選ぶ
          </button>
        </div>
        {preparing && <p className="muted small">写真を読み込んでいます…</p>}
        {image && (
          <div className="photo-preview">
            <img src={`data:${image.mediaType};base64,${image.data}`} alt="選んだ食事の写真" />
            <button type="button" className="button secondary" onClick={removeImage} disabled={busyPhoto}>
              写真を外す
            </button>
          </div>
        )}
        <input
          type="text"
          maxLength={MAX_MEAL_LABEL_LENGTH}
          placeholder={image ? '内容・補足（例: カツ丼 ご飯少なめ）' : '内容（例: 親子丼 ご飯少なめ）'}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="食事の内容"
        />
        {image && (
          <>
            <button
              type="button"
              className="button"
              onClick={() => void estimate()}
              disabled={busyPhoto || photoLeft === 0}
            >
              {photo.status === 'done' ? '直した内容で計算し直す' : 'AIでカロリーを計算する'}
            </button>
            {photoLeft !== null && photoLeft > 0 && (
              <p className="muted small photo-left">
                {photo.status === 'done'
                  ? `料理名や量が違っていたら、内容を直して計算し直せます（もう1回使います。今日あと${photoLeft}回）`
                  : `料理名や「ご飯少なめ」などを書いてから計算すると、AIが参考にします（今日あと${photoLeft}回）`}
              </p>
            )}
          </>
        )}
        {photoLeft === 0 && (
          <p className="muted small">
            今日の写真の判定は上限（{DAILY_ESTIMATE_LIMIT}回）に達しました。時刻とkcalを手入力してください。
          </p>
        )}
        {!image && photoLeft !== null && photoLeft > 0 && (
          <p className="muted small photo-left">写真からカロリーを計算できます（今日あと{photoLeft}回）</p>
        )}
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
  // 保存済みのときは内容を表示し、「編集」で書き直す（保存できたことが分かるように）
  const [editing, setEditing] = useState(!saved)
  const [busy, setBusy] = useState(false)
  const dirty = text.trim() !== saved
  const title = (
    <div className="card-title">
      <TitleWithHelp title={date === today ? '今日の運動' : 'この日の運動'} help="運動の記録について">
        <ExerciseHelp />
      </TitleWithHelp>
    </div>
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    setBusy(true)
    try {
      await saveExercise(date, value)
      setText(value)
      setEditing(!value)
    } catch {
      alert('保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <section className="card form">
        {title}
        <p className="saved-text">{saved}</p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={() => setEditing(true)}>
            編集
          </button>
          <span className="saved-mark small">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            保存済み
          </span>
        </div>
      </section>
    )
  }

  return (
    <form className="card form" onSubmit={submit}>
      {title}
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
          {busy ? '保存中…' : '保存'}
        </button>
        {saved && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setText(saved)
              setEditing(false)
            }}
          >
            キャンセル
          </button>
        )}
      </div>
    </form>
  )
}

function WeightCard({ date, today, records }: { date: string; today: string; records: WeightRecord[] }) {
  const open = records.length < MAX_WEIGHINS_PER_DAY
  return (
    <section className="card">
      <div className="card-title">
        <TitleWithHelp title="体重" help="体重の記録について">
          <WeightHelp />
        </TitleWithHelp>
        <span className="muted small">1日{MAX_WEIGHINS_PER_DAY}回まで</span>
      </div>
      <div className="slots">
        {records.map((r) => (
          <div key={r.seq} className="slot-row">
            <span className="slot-time num muted">{r.time}</span>
            <span className="slot-value num">
              {r.weight.toFixed(1)}
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
        ))}
        {open && <WeightForm date={date} />}
      </div>
      {open && date !== today && <p className="muted small slot-note">過去の日の記録にはAIのひとことはつきません。</p>}
    </section>
  )
}

function WeightForm({ date }: { date: string }) {
  const { data, recordWeight } = useStore()
  const [time, setTime] = useState(localTime)
  const [timeEdited, setTimeEdited] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const w = Math.round(Number(value) * 10) / 10
    if (!Number.isFinite(w) || w < 20 || w > 300) {
      alert('20〜300 kg の範囲で入力してください')
      return
    }
    // 打ち間違いに気づけるよう、直前の記録から大きく離れていたら知らせる
    const here: WeightRecord = { date, seq: MAX_WEIGHINS_PER_DAY + 1, time, weight: w }
    const prev = data!.weights
      .filter((r) => compareRecords(r, here) < 0)
      .sort(compareRecords)
      .at(-1)
    let message = `${time} の体重 ${w.toFixed(1)} kg を記録します。\n記録したあとは変更できません。`
    if (prev && Math.abs(w - prev.weight) >= 2) {
      const diff = w - prev.weight
      message =
        `前回（${formatDate(prev.date)} ${prev.time} ${prev.weight.toFixed(1)} kg）から ` +
        `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} kg です。入力に間違いはありませんか？\n\n${message}`
    }
    if (!confirm(message)) return
    setBusy(true)
    try {
      await recordWeight(date, time, w)
      setValue('')
      setTime(localTime())
      setTimeEdited(false)
    } catch (err) {
      alert(
        err instanceof AlreadyRecorded
          ? `この日の体重はすでに${MAX_WEIGHINS_PER_DAY}回記録されています`
          : '保存できませんでした',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="slot-row" onSubmit={submit}>
      <input
        className="time-input"
        type="time"
        value={time}
        onChange={(e) => {
          setTime(e.target.value)
          setTimeEdited(true)
        }}
        aria-label="量った時刻"
        required
      />
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        placeholder="例: 62.4"
        value={value}
        // 画面を開いたままでも、量った直後の時刻になるようにする
        onFocus={() => {
          if (!timeEdited) setTime(localTime())
        }}
        onChange={(e) => setValue(e.target.value)}
        aria-label="体重(kg)"
      />
      <span className="unit">kg</span>
      <button className="button" disabled={busy || !value || !time}>
        記録
      </button>
    </form>
  )
}

function WeekCard({ plan, weight }: { plan: Plan; weight: number }) {
  const title = (
    <TitleWithHelp title="今週の目標" help="今週の目標について">
      <WeekHelp plan={plan} />
    </TitleWithHelp>
  )

  if (plan.phase === 'before') {
    return (
      <section className="card">
        <div className="card-title">{title}</div>
        <p className="muted">目標期間はまだ始まっていません。</p>
      </section>
    )
  }
  if (plan.phase === 'finished' || !plan.current) {
    return (
      <section className="card">
        <div className="card-title">{title}</div>
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
        {title}
        <span className="muted small">
          第{w.index + 1}週 / 全{Math.ceil(plan.totalWeeks)}週
        </span>
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
        当初の計画は週 −{plan.initialWeeklyLoss.toFixed(2)} kg
      </p>
      {fast && <p className="warning small">ペースが速めです。無理をせず、期間の延長も検討してください。</p>}
    </section>
  )
}
