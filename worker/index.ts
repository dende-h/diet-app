import { verifyToken } from '@clerk/backend'
import { Hono } from 'hono'
import {
  ACTIVITY_LEVELS,
  addDays,
  isValidDate,
  isWeightSlot,
  type Goal,
  type Profile,
  type WeightSlot,
} from '../shared/calc'
import * as db from './db'
import { generateFeedback } from './feedback'

type Bindings = {
  DB: D1Database
  CLERK_SECRET_KEY: string
  /** 任意。ClerkのJWT公開鍵(PEM)。設定するとClerkへの通信なしでトークンを検証する */
  CLERK_JWT_KEY?: string
  ANTHROPIC_API_KEY: string
  /** 任意。カンマ区切りで指定すると、そのClerkユーザー以外はAPIを使えなくなる */
  ALLOWED_USER_IDS?: string
}

const app = new Hono<{ Bindings: Bindings; Variables: { userId: string } }>().basePath('/api')

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

function slot(value: unknown): WeightSlot {
  if (!isWeightSlot(value)) throw new BadRequest('slot must be morning or evening')
  return value
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
  await next()
})

app.get('/data', async (c) => {
  return c.json(await db.loadUserData(c.env.DB, c.get('userId')))
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
  await db.saveGoal(c.env.DB, c.get('userId'), goal)
  return c.json(goal)
})

// 体重は朝・夜の枠ごとに1回だけ。記録後は変更も削除もできない
app.post('/weights/:date/:slot', async (c) => {
  const d = date(c.req.param('date'))
  const s = slot(c.req.param('slot'))
  if (d > addDays(serverToday(), 1)) throw new BadRequest('未来の日付には記録できません')
  const body = await c.req.json<Record<string, unknown>>()
  const record = { date: d, slot: s, weight: Math.round(num(body.weight, 20, 300, 'weight') * 10) / 10 }
  if (!(await db.insertWeight(c.env.DB, c.get('userId'), record))) {
    return c.json({ error: 'この枠はすでに記録済みです' }, 409)
  }
  return c.json(record, 201)
})

app.post('/intakes', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const d = date(body.date)
  const kcal = Math.round(num(body.kcal, 1, 10000, 'kcal'))
  const label = typeof body.label === 'string' ? body.label.slice(0, 40) : ''
  return c.json(await db.addIntake(c.env.DB, c.get('userId'), d, kcal, label))
})

app.delete('/intakes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new BadRequest('invalid id')
  await db.deleteIntake(c.env.DB, c.get('userId'), id)
  return c.body(null, 204)
})

app.get('/feedbacks/:date', async (c) => {
  const feedbacks = await db.listFeedbacks(c.env.DB, c.get('userId'), date(c.req.param('date')))
  return c.json({ feedbacks: feedbacks.filter((f) => f.status === 'done') })
})

// 体重を記録した枠へのAIフィードバック。まだなければ生成する（枠ごとに1回なので1日最大2回）
app.post('/feedbacks/:date/:slot', async (c) => {
  const userId = c.get('userId')
  const d = date(c.req.param('date'))
  const s = slot(c.req.param('slot'))
  // さかのぼって記録した過去の日では生成しない（端末の日付を使うので、サーバー時刻の前後1日に限る）
  const today = serverToday()
  if (d < addDays(today, -1) || d > addDays(today, 1)) throw new BadRequest('date is out of range')

  const existing = await db.getFeedback(c.env.DB, userId, d, s)
  if (existing?.status === 'done') return c.json({ status: 'done', content: existing.content })
  if (!(await db.hasWeight(c.env.DB, userId, d, s))) throw new BadRequest('先に体重を記録してください')

  const data = await db.loadUserData(c.env.DB, userId)
  if (!data.profile || !data.goal) return c.json({ status: 'unavailable' })

  if (!(await db.claimFeedback(c.env.DB, userId, d, s))) return c.json({ status: 'pending' })
  try {
    const content = await generateFeedback(c.env.ANTHROPIC_API_KEY, data, d, s)
    await db.completeFeedback(c.env.DB, userId, d, s, content)
    return c.json({ status: 'done', content })
  } catch (err) {
    await db.releaseFeedback(c.env.DB, userId, d, s)
    console.error('feedback generation failed', err)
    return c.json({ status: 'error' }, 502)
  }
})

export default app
