import { verifyToken } from '@clerk/backend'
import { Hono } from 'hono'
import {
  ACTIVITY_LEVELS,
  addDays,
  isValidDate,
  isValidTime,
  MAX_EXERCISE_LENGTH,
  MAX_WEIGHINS_PER_DAY,
  type Goal,
  type Profile,
} from '../shared/calc'
import { Cipher } from './crypto'
import * as db from './db'
import { estimateCalories } from './estimate'
import { generateFeedback } from './feedback'

type Bindings = {
  DB: D1Database
  CLERK_SECRET_KEY: string
  /** 任意。ClerkのJWT公開鍵(PEM)。設定するとClerkへの通信なしでトークンを検証する */
  CLERK_JWT_KEY?: string
  ANTHROPIC_API_KEY: string
  /** 任意。カンマ区切りで指定すると、そのClerkユーザー以外はAPIを使えなくなる */
  ALLOWED_USER_IDS?: string
  /** 体重などを暗号化する鍵（32バイトを base64 にしたもの） */
  DATA_KEY: string
}

const app = new Hono<{ Bindings: Bindings; Variables: { userId: string; cipher: Cipher } }>().basePath('/api')

class BadRequest extends Error {}

function num(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequest(`${name} must be a number between ${min} and ${max}`)
  }
  return value
}

function date(value: unknown, name = 'date'): string {
  if (!isValidDate(value)) throw new BadRequest(`${name} must be YYYY-MM-DD`)
  return value
}

/** その日の何回目の体重の記録か */
function seq(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_WEIGHINS_PER_DAY) {
    throw new BadRequest(`seq must be 1 to ${MAX_WEIGHINS_PER_DAY}`)
  }
  return n
}

/** サーバー時刻（UTC）の今日。端末の日付とはタイムゾーンでずれるので、前後1日の幅で比べる */
function serverToday(): string {
  return new Date().toISOString().slice(0, 10)
}

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400)
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

// 全APIでClerkのセッショントークンを検証し、ユーザーIDでデータを分離する
app.use('*', async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return c.json({ error: 'unauthorized' }, 401)
  let userId: string
  try {
    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      jwtKey: c.env.CLERK_JWT_KEY,
      // フロントとAPIは同一オリジンなので、このオリジンで発行されたトークンだけを受け付ける
      authorizedParties: [new URL(c.req.url).origin],
    })
    userId = payload.sub
  } catch {
    return c.json({ error: 'unauthorized' }, 401)
  }
  const allowed = c.env.ALLOWED_USER_IDS?.split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed?.length && !allowed.includes(userId)) return c.json({ error: 'forbidden' }, 403)
  c.set('userId', userId)
  c.set('cipher', await Cipher.create(c.env.DATA_KEY, userId))
  await next()
})

app.get('/data', async (c) => {
  const { DB } = c.env
  const cipher = c.get('cipher')
  const userId = c.get('userId')
  // 暗号化を入れる前に保存された値があれば、応答を返したあとに暗号化し直す
  c.executionCtx.waitUntil(db.encryptLegacyRows(DB, cipher, userId).catch((err) => console.error('encrypt legacy rows failed', err)))
  return c.json(await db.loadUserData(DB, cipher, userId))
})

app.put('/profile', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  if (body.sex !== 'male' && body.sex !== 'female') throw new BadRequest('sex must be male or female')
  if (!ACTIVITY_LEVELS.some((a) => a.value === body.activity)) throw new BadRequest('invalid activity')
  const profile: Profile = {
    sex: body.sex,
    birthYear: num(body.birthYear, 1900, 2100, 'birthYear'),
    heightCm: num(body.heightCm, 100, 250, 'heightCm'),
    activity: body.activity as number,
  }
  await db.saveProfile(c.env.DB, c.get('userId'), profile)
  return c.json(profile)
})

app.post('/goal', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const goal: Goal = {
    startDate: date(body.startDate, 'startDate'),
    endDate: date(body.endDate, 'endDate'),
    startWeight: num(body.startWeight, 20, 300, 'startWeight'),
    lossKg: num(body.lossKg, 0.1, 100, 'lossKg'),
  }
  if (goal.endDate <= addDays(goal.startDate, 6)) throw new BadRequest('期間は1週間以上にしてください')
  if (goal.lossKg >= goal.startWeight) throw new BadRequest('lossKg is too large')
  await db.saveGoal(c.env.DB, c.get('cipher'), c.get('userId'), goal)
  return c.json(goal)
})

// 体重は時刻つきで1日2回まで。記録後は変更も削除もできない
app.post('/weights/:date', async (c) => {
  const d = date(c.req.param('date'))
  if (d > addDays(serverToday(), 1)) throw new BadRequest('未来の日付には記録できません')
  const body = await c.req.json<Record<string, unknown>>()
  if (!isValidTime(body.time)) throw new BadRequest('time must be HH:MM')
  const weight = Math.round(num(body.weight, 20, 300, 'weight') * 10) / 10
  const saved = await db.insertWeight(c.env.DB, c.get('cipher'), c.get('userId'), { date: d, time: body.time, weight })
  if (!saved) return c.json({ error: `この日の体重はすでに${MAX_WEIGHINS_PER_DAY}回記録しています` }, 409)
  return c.json(saved, 201)
})

app.post('/intakes', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const time = body.time ?? ''
  if (time !== '' && !isValidTime(time)) throw new BadRequest('time must be HH:MM')
  const entry = {
    date: date(body.date),
    time: time as string,
    kcal: Math.round(num(body.kcal, 1, 10000, 'kcal')),
    label: typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '',
  }
  return c.json(await db.addIntake(c.env.DB, c.get('userId'), entry))
})

// 写真から食事のカロリーを見積もる（数字だけ。写真は保存しない）
const ESTIMATE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** 不具合で呼び出しが止まらなくなっても費用がふくらまないよう、1人1日の回数に上限を置く */
const DAILY_ESTIMATE_LIMIT = 30

app.post('/estimate', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const mediaType = ESTIMATE_TYPES.find((t) => t === body.mediaType)
  if (!mediaType) throw new BadRequest('mediaType must be image/jpeg, image/png or image/webp')
  if (typeof body.image !== 'string' || body.image.length === 0 || body.image.length > 4_000_000) {
    throw new BadRequest('image must be base64 (up to about 3MB)')
  }
  const used = await db.countEstimate(c.env.DB, c.get('userId'), serverToday())
  if (used > DAILY_ESTIMATE_LIMIT) {
    return c.json({ error: `写真からの計算は1日${DAILY_ESTIMATE_LIMIT}回までです` }, 429)
  }
  try {
    const estimate = await estimateCalories(c.env.ANTHROPIC_API_KEY, body.image, mediaType)
    if (estimate.items.length === 0) return c.json({ error: '食べ物が写っていないようです' }, 422)
    return c.json(estimate)
  } catch (err) {
    console.error('calorie estimate failed', err)
    return c.json({ error: 'カロリーを計算できませんでした' }, 502)
  }
})

// その日の運動（自由記述）。空にすると削除
app.put('/exercises/:date', async (c) => {
  const d = date(c.req.param('date'))
  const body = await c.req.json<Record<string, unknown>>()
  if (typeof body.text !== 'string') throw new BadRequest('text must be a string')
  const text = body.text.trim().slice(0, MAX_EXERCISE_LENGTH)
  await db.saveExercise(c.env.DB, c.get('userId'), d, text)
  return c.json({ date: d, text })
})

app.delete('/intakes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new BadRequest('invalid id')
  await db.deleteIntake(c.env.DB, c.get('userId'), id)
  return c.body(null, 204)
})

app.get('/feedbacks/:date', async (c) => {
  const feedbacks = await db.listFeedbacks(c.env.DB, c.get('cipher'), c.get('userId'), date(c.req.param('date')))
  return c.json({ feedbacks: feedbacks.filter((f) => f.status === 'done') })
})

// 体重の記録へのAIフィードバック。まだなければ生成する（記録ごとに1回なので1日最大2回）
app.post('/feedbacks/:date/:seq', async (c) => {
  const userId = c.get('userId')
  const d = date(c.req.param('date'))
  const s = seq(c.req.param('seq'))
  // さかのぼって記録した過去の日では生成しない（端末の日付を使うので、サーバー時刻の前後1日に限る）
  const today = serverToday()
  if (d < addDays(today, -1) || d > addDays(today, 1)) throw new BadRequest('date is out of range')

  const existing = await db.getFeedback(c.env.DB, c.get('cipher'), userId, d, s)
  if (existing?.status === 'done') return c.json({ status: 'done', content: existing.content })
  if (!(await db.hasWeight(c.env.DB, userId, d, s))) throw new BadRequest('先に体重を記録してください')

  const data = await db.loadUserData(c.env.DB, c.get('cipher'), userId)
  if (!data.profile || !data.goal) return c.json({ status: 'unavailable' })

  if (!(await db.claimFeedback(c.env.DB, userId, d, s))) return c.json({ status: 'pending' })
  try {
    const content = await generateFeedback(c.env.ANTHROPIC_API_KEY, data, d, s)
    await db.completeFeedback(c.env.DB, c.get('cipher'), userId, d, s, content)
    return c.json({ status: 'done', content })
  } catch (err) {
    await db.releaseFeedback(c.env.DB, userId, d, s)
    console.error('feedback generation failed', err)
    return c.json({ status: 'error' }, 502)
  }
})

export default app
