// 「昨日の振り返り」。ふつうは朝いちばんの体重を記録したときにアプリから作る（POST /reviews/:date）。
// 体重を量らなかった日は、昼に cron（wrangler.jsonc の triggers）で作り、スマホに通知する。
// 夜には、その日の記録がまだの人にリマインドを通知する（設定でオンにした人だけ）。
import { addDays, hasRecords, reminderBody, type UserData } from '../shared/calc'
import { Cipher } from './crypto'
import * as db from './db'
import type { Bindings } from './env'
import { generateDailyReview } from './feedback'
import { loadVapid, sendPush, type PushMessage, type Vapid } from './push'

/** 2人とも日本で使うので、まとめる「今日」は日本時間で決める */
export function japanDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

export function allowedUsers(env: Bindings): string[] | null {
  const ids = env.ALLOWED_USER_IDS?.split(',').map((s) => s.trim()).filter(Boolean)
  return ids?.length ? ids : null
}

/** 記録のリマインドを送る cron（wrangler.jsonc の triggers.crons と同じ文字列。UTC 12:00 = 日本時間 21:00） */
export const REMINDER_CRON = '0 12 * * *'

export type ReviewResult = 'done' | 'pending' | 'error'

/** まとめを作って保存する。regenerate ならできているものを作り直す */
export async function writeReview(
  env: Bindings,
  cipher: Cipher,
  userId: string,
  date: string,
  data: UserData,
  regenerate: boolean,
): Promise<ReviewResult> {
  if (!(await db.claimReview(env.DB, userId, date, regenerate))) return 'pending'
  try {
    // 前に書いた文章（振り返る日の翌日＝今日までのひとこと、前の日までの振り返り）を渡して、繰り返しを避ける
    const past = await db.recentAiTexts(env.DB, cipher, userId, { until: addDays(date, 1), reviewBefore: date })
    const content = await generateDailyReview(env.ANTHROPIC_API_KEY, data, date, past)
    await db.completeReview(env.DB, cipher, userId, date, content)
    return 'done'
  } catch (err) {
    await db.releaseReview(env.DB, userId, date)
    console.error('daily review generation failed', err)
    return 'error'
  }
}

/** 通知の送り主として通知サーバーに伝える連絡先（https のURL） */
function subject(env: Bindings): string {
  return env.PUSH_SUBJECT || 'https://diet-app.dende0206.workers.dev'
}

export async function getVapid(env: Bindings): Promise<Vapid | null> {
  return env.VAPID_PRIVATE_KEY ? loadVapid(env.VAPID_PRIVATE_KEY) : null
}

/** そのユーザーの全端末に通知する。端末側で購読がなくなっていれば送り先を消す */
export async function notify(env: Bindings, vapid: Vapid, userId: string, message: PushMessage) {
  const targets = await db.listPushSubscriptions(env.DB, userId)
  let sent = 0
  for (const t of targets) {
    try {
      const res = await sendPush(t, message, vapid, subject(env))
      if (res.ok) sent++
      else if (res.gone) await db.deletePushSubscription(env.DB, userId, t.endpoint)
      else console.error('push failed', res.status, new URL(t.endpoint).hostname)
    } catch (err) {
      console.error('push failed', err)
    }
  }
  return { sent, total: targets.length }
}

/**
 * 昼の自動生成。昨日の振り返りがまだなく、昨日に何か記録している人の分を作って通知する。
 * cron は2回動かし、1回目で失敗した人の分を2回目で作り直す（できている人は飛ばすので通知も1回）。
 */
export async function runReviewFallback(env: Bindings, now = new Date()) {
  const today = japanDate(now)
  const date = addDays(today, -1)
  const allowed = allowedUsers(env)
  const userIds = (await db.listUserIds(env.DB)).filter((id) => !allowed || allowed.includes(id))
  const vapid = await getVapid(env).catch((err) => {
    console.error('invalid VAPID_PRIVATE_KEY', err)
    return null
  })
  for (const userId of userIds) {
    try {
      const cipher = await Cipher.create(env.DATA_KEY, userId)
      if (await db.getReview(env.DB, cipher, userId, date)) continue
      const data = await db.loadUserData(env.DB, cipher, userId)
      if (!data.profile || !data.goal || !hasRecords(data, date)) continue
      if ((await writeReview(env, cipher, userId, date, data, false)) !== 'done' || !vapid) continue
      // 通知を押すと今日の画面（昨日の振り返りがいちばん上）を開く
      await notify(env, vapid, userId, { title: '昨日の振り返り', body: '昨日の記録をAIが振り返りました', date: today })
    } catch (err) {
      console.error('review fallback failed', err)
    }
  }
}

/** 夜のリマインド。オンにしている人のうち、今日の体重か食事をまだ記録していない人に通知する */
export async function runLogReminder(env: Bindings, now = new Date()) {
  const today = japanDate(now)
  const vapid = await getVapid(env).catch((err) => {
    console.error('invalid VAPID_PRIVATE_KEY', err)
    return null
  })
  if (!vapid) return
  const allowed = allowedUsers(env)
  const userIds = (await db.listReminderUserIds(env.DB)).filter((id) => !allowed || allowed.includes(id))
  for (const userId of userIds) {
    try {
      const body = reminderBody(await db.loadRecordDates(env.DB, userId, today), today)
      if (body) await notify(env, vapid, userId, { title: '記録のリマインド', body, date: today, kind: 'reminder' })
    } catch (err) {
      console.error('log reminder failed', err)
    }
  }
}
