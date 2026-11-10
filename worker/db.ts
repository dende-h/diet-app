import {
  MAX_REVIEW_GENERATIONS,
  type ExerciseEntry,
  type Goal,
  type IntakeEntry,
  type Profile,
  type Sex,
  type StoredFeedback,
  type UserData,
  type WeightRecord,
} from '../shared/calc'
import { isEncrypted, type Cipher } from './crypto'

// 体重に関わる値（体重、目標の開始体重・減量kg、AIのひとこと）は暗号化して保存する。
// 読み書きはここで暗号化・復号するので、ほかの場所では平文のまま扱える。

interface ProfileRow {
  sex: Sex
  birth_year: number
  height_cm: number
  activity: number
}

interface GoalRow {
  start_date: string
  end_date: string
  /** 暗号文（暗号化を入れる前の行は数値） */
  start_weight: string | number
  loss_kg: string | number
}

interface WeightRow {
  date: string
  seq: number
  time: string
  weight: string | number
}

export async function loadUserData(db: D1Database, cipher: Cipher, userId: string): Promise<UserData> {
  const [profile, goal, weights, intakes, exercises] = await db.batch([
    db.prepare('SELECT sex, birth_year, height_cm, activity FROM profiles WHERE user_id = ?').bind(userId),
    db
      .prepare('SELECT start_date, end_date, start_weight, loss_kg FROM goals WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .bind(userId),
    db.prepare('SELECT date, seq, time, weight FROM weights WHERE user_id = ? ORDER BY date, time, seq').bind(userId),
    db
      .prepare('SELECT id, date, time, kcal, label FROM intakes WHERE user_id = ? ORDER BY date, time, id')
      .bind(userId),
    db.prepare('SELECT date, text FROM exercises WHERE user_id = ? ORDER BY date').bind(userId),
  ])
  const p = (profile.results as ProfileRow[])[0]
  const g = (goal.results as GoalRow[])[0]
  return {
    profile: p ? { sex: p.sex, birthYear: p.birth_year, heightCm: p.height_cm, activity: p.activity } : null,
    goal: g
      ? {
          startDate: g.start_date,
          endDate: g.end_date,
          startWeight: await cipher.decryptNumber(g.start_weight, 'goals.start_weight'),
          lossKg: await cipher.decryptNumber(g.loss_kg, 'goals.loss_kg'),
        }
      : null,
    weights: await Promise.all(
      (weights.results as unknown as WeightRow[]).map(async (w) => ({
        date: w.date,
        seq: w.seq,
        time: w.time,
        weight: await cipher.decryptNumber(w.weight, 'weights.weight'),
      })),
    ),
    intakes: intakes.results as unknown as IntakeEntry[],
    exercises: exercises.results as unknown as ExerciseEntry[],
  }
}

export async function saveProfile(db: D1Database, userId: string, p: Profile) {
  await db
    .prepare(
      `INSERT INTO profiles (user_id, sex, birth_year, height_cm, activity) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET sex = excluded.sex, birth_year = excluded.birth_year,
         height_cm = excluded.height_cm, activity = excluded.activity, updated_at = datetime('now')`,
    )
    .bind(userId, p.sex, p.birthYear, p.heightCm, p.activity)
    .run()
}

export async function saveGoal(db: D1Database, cipher: Cipher, userId: string, g: Goal) {
  await db
    .prepare('INSERT INTO goals (user_id, start_date, end_date, start_weight, loss_kg) VALUES (?, ?, ?, ?, ?)')
    .bind(
      userId,
      g.startDate,
      g.endDate,
      await cipher.encryptNumber(g.startWeight, 'goals.start_weight'),
      await cipher.encryptNumber(g.lossKg, 'goals.loss_kg'),
    )
    .run()
}

/**
 * 体重を記録する。その日の記録がすでに2回あれば何もせず null を返す（記録後は変更しない）。
 * 何回目かは記録時に数え、同時に送られても主キーの重複で弾かれる。
 */
export async function insertWeight(
  db: D1Database,
  cipher: Cipher,
  userId: string,
  r: { date: string; time: string; weight: number },
): Promise<WeightRecord | null> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO weights (user_id, date, seq, time, weight)
         SELECT ?1, ?2, COUNT(*) + 1, ?3, ?4 FROM weights WHERE user_id = ?1 AND date = ?2
         HAVING COUNT(*) < 2
         RETURNING date, seq, time`,
      )
      .bind(userId, r.date, r.time, await cipher.encryptNumber(r.weight, 'weights.weight'))
      .first<Omit<WeightRecord, 'weight'>>()
    return row ? { ...row, weight: r.weight } : null
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) return null
    throw err
  }
}

export async function hasWeight(db: D1Database, userId: string, date: string, seq: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM weights WHERE user_id = ? AND date = ? AND seq = ?')
    .bind(userId, date, seq)
    .first()
  return row !== null
}

export async function addIntake(db: D1Database, userId: string, entry: Omit<IntakeEntry, 'id'>) {
  return db
    .prepare(
      'INSERT INTO intakes (user_id, date, time, kcal, label) VALUES (?, ?, ?, ?, ?) RETURNING id, date, time, kcal, label',
    )
    .bind(userId, entry.date, entry.time, entry.kcal, entry.label)
    .first<IntakeEntry>()
}

/** その日の運動を保存する。空なら削除する */
export async function saveExercise(db: D1Database, userId: string, date: string, text: string) {
  if (!text) {
    await db.prepare('DELETE FROM exercises WHERE user_id = ? AND date = ?').bind(userId, date).run()
    return
  }
  await db
    .prepare(
      `INSERT INTO exercises (user_id, date, text) VALUES (?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`,
    )
    .bind(userId, date, text)
    .run()
}

export async function getEstimateCount(db: D1Database, userId: string, date: string): Promise<number> {
  const row = await db
    .prepare('SELECT count FROM estimate_usage WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .first<{ count: number }>()
  return row?.count ?? 0
}

/** 写真からのカロリー推定の回数を1増やし、その日の合計を返す */
export async function countEstimate(db: D1Database, userId: string, date: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO estimate_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(userId, date)
    .first<{ count: number }>()
  return row?.count ?? 1
}

export async function deleteIntake(db: D1Database, userId: string, id: number) {
  await db.prepare('DELETE FROM intakes WHERE user_id = ? AND id = ?').bind(userId, id).run()
}

// ---- AIフィードバック（体重の記録ごとに1件） ----

async function decryptFeedback(cipher: Cipher, f: StoredFeedback): Promise<StoredFeedback> {
  return { ...f, content: await cipher.decrypt(f.content, 'feedbacks.content') }
}

export async function listFeedbacks(
  db: D1Database,
  cipher: Cipher,
  userId: string,
  date: string,
): Promise<StoredFeedback[]> {
  const { results } = await db
    .prepare('SELECT seq, status, content FROM feedbacks WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .all<StoredFeedback>()
  return Promise.all(results.map((f) => decryptFeedback(cipher, f)))
}

export async function getFeedback(db: D1Database, cipher: Cipher, userId: string, date: string, seq: number) {
  const row = await db
    .prepare('SELECT seq, status, content FROM feedbacks WHERE user_id = ? AND date = ? AND seq = ?')
    .bind(userId, date, seq)
    .first<StoredFeedback>()
  return row ? decryptFeedback(cipher, row) : null
}

/**
 * その記録へのフィードバック生成権を取る。true なら呼び出し側がAIを呼ぶ。
 * 生成途中で落ちた pending が2分以上残っていれば取り直す。
 */
export async function claimFeedback(db: D1Database, userId: string, date: string, seq: number): Promise<boolean> {
  const inserted = await db
    .prepare(
      "INSERT INTO feedbacks (user_id, date, seq, status) VALUES (?, ?, ?, 'pending') ON CONFLICT (user_id, date, seq) DO NOTHING",
    )
    .bind(userId, date, seq)
    .run()
  if (inserted.meta.changes === 1) return true
  const stale = await db
    .prepare(
      `UPDATE feedbacks SET created_at = datetime('now')
       WHERE user_id = ? AND date = ? AND seq = ? AND status = 'pending' AND created_at < datetime('now', '-2 minutes')`,
    )
    .bind(userId, date, seq)
    .run()
  return stale.meta.changes === 1
}

export async function completeFeedback(
  db: D1Database,
  cipher: Cipher,
  userId: string,
  date: string,
  seq: number,
  content: string,
) {
  await db
    .prepare("UPDATE feedbacks SET content = ?, status = 'done' WHERE user_id = ? AND date = ? AND seq = ?")
    .bind(await cipher.encrypt(content, 'feedbacks.content'), userId, date, seq)
    .run()
}

export async function releaseFeedback(db: D1Database, userId: string, date: string, seq: number) {
  await db
    .prepare("DELETE FROM feedbacks WHERE user_id = ? AND date = ? AND seq = ? AND status = 'pending'")
    .bind(userId, date, seq)
    .run()
}

// ---- 昨日の振り返り（1人1日1件。date は振り返る日） ----

interface ReviewRow {
  content: string
  status: 'pending' | 'done'
  generations: number
}

/** content は作り直し中（pending）でも前の版が入っている。まだ一度もできていなければ空 */
export async function getReview(db: D1Database, cipher: Cipher, userId: string, date: string) {
  const row = await db
    .prepare('SELECT content, status, generations FROM daily_reviews WHERE user_id = ? AND date = ?')
    .bind(userId, date)
    .first<ReviewRow>()
  if (!row) return null
  return { ...row, content: row.generations > 0 ? await cipher.decrypt(row.content, 'daily_reviews.content') : '' }
}

/**
 * まとめの生成権を取る。true なら呼び出し側がAIを呼ぶ。
 * regenerate が false なら、まだないときだけ取る（夜の自動生成）。true ならできているものを作り直す（回数に上限あり）。
 * 生成途中で落ちた pending が2分以上残っていれば取り直す。
 */
export async function claimReview(db: D1Database, userId: string, date: string, regenerate: boolean): Promise<boolean> {
  const inserted = await db
    .prepare(
      "INSERT INTO daily_reviews (user_id, date, status) VALUES (?, ?, 'pending') ON CONFLICT (user_id, date) DO NOTHING",
    )
    .bind(userId, date)
    .run()
  if (inserted.meta.changes === 1) return true
  const claimed = await db
    .prepare(
      `UPDATE daily_reviews SET status = 'pending', created_at = datetime('now')
       WHERE user_id = ?1 AND date = ?2 AND generations < ?3
         AND ((status = 'pending' AND created_at < datetime('now', '-2 minutes'))
           OR (?4 = 1 AND status = 'done'))`,
    )
    .bind(userId, date, MAX_REVIEW_GENERATIONS, regenerate ? 1 : 0)
    .run()
  return claimed.meta.changes === 1
}

export async function completeReview(db: D1Database, cipher: Cipher, userId: string, date: string, content: string) {
  await db
    .prepare(
      `UPDATE daily_reviews SET content = ?, status = 'done', generations = generations + 1, created_at = datetime('now')
       WHERE user_id = ? AND date = ?`,
    )
    .bind(await cipher.encrypt(content, 'daily_reviews.content'), userId, date)
    .run()
}

/** 生成に失敗したとき。初回なら行を消し、作り直しなら前の版に戻す */
export async function releaseReview(db: D1Database, userId: string, date: string) {
  await db.batch([
    db
      .prepare("DELETE FROM daily_reviews WHERE user_id = ? AND date = ? AND status = 'pending' AND generations = 0")
      .bind(userId, date),
    db
      .prepare("UPDATE daily_reviews SET status = 'done' WHERE user_id = ? AND date = ? AND status = 'pending'")
      .bind(userId, date),
  ])
}

/** プロフィールを登録しているユーザー（振り返りを自動で作る対象） */
export async function listUserIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT user_id FROM profiles').all<{ user_id: string }>()
  return results.map((r) => r.user_id)
}

// ---- 通知の送り先（Web Push の購読） ----

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

export async function savePushSubscription(db: D1Database, userId: string, s: PushSubscriptionRow) {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(s.endpoint, userId, s.p256dh, s.auth)
    .run()
}

export async function listPushSubscriptions(db: D1Database, userId: string): Promise<PushSubscriptionRow[]> {
  const { results } = await db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<PushSubscriptionRow>()
  return results
}

export async function deletePushSubscription(db: D1Database, userId: string, endpoint: string) {
  await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run()
}

// ---- 暗号化を入れる前に保存された値の暗号化 ----

/**
 * そのユーザーの、まだ平文のまま残っている体重・目標・ひとことを暗号化し直す。
 * 鍵は Worker の中にしかないので、DBのマイグレーションではなくアプリを開いたときに行う。
 * 一度暗号化すれば対象がなくなるので、2回目以降はSELECTだけで終わる。
 */
export async function encryptLegacyRows(db: D1Database, cipher: Cipher, userId: string) {
  const [weights, goals, feedbacks] = await db.batch([
    db.prepare("SELECT date, seq, weight FROM weights WHERE user_id = ? AND typeof(weight) != 'text'").bind(userId),
    db
      .prepare(
        "SELECT id, start_weight, loss_kg FROM goals WHERE user_id = ? AND (typeof(start_weight) != 'text' OR typeof(loss_kg) != 'text')",
      )
      .bind(userId),
    db
      .prepare("SELECT date, seq, content FROM feedbacks WHERE user_id = ? AND status = 'done' AND content NOT LIKE 'v1:%'")
      .bind(userId),
  ])
  const updates: D1PreparedStatement[] = []
  for (const w of weights.results as { date: string; seq: number; weight: number }[]) {
    updates.push(
      db
        .prepare('UPDATE weights SET weight = ? WHERE user_id = ? AND date = ? AND seq = ?')
        .bind(await cipher.encryptNumber(w.weight, 'weights.weight'), userId, w.date, w.seq),
    )
  }
  for (const g of goals.results as { id: number; start_weight: number | string; loss_kg: number | string }[]) {
    const startWeight = isEncrypted(g.start_weight)
      ? g.start_weight
      : await cipher.encryptNumber(Number(g.start_weight), 'goals.start_weight')
    const lossKg = isEncrypted(g.loss_kg) ? g.loss_kg : await cipher.encryptNumber(Number(g.loss_kg), 'goals.loss_kg')
    updates.push(
      db.prepare('UPDATE goals SET start_weight = ?, loss_kg = ? WHERE user_id = ? AND id = ?').bind(startWeight, lossKg, userId, g.id),
    )
  }
  for (const f of feedbacks.results as { date: string; seq: number; content: string }[]) {
    updates.push(
      db
        .prepare('UPDATE feedbacks SET content = ? WHERE user_id = ? AND date = ? AND seq = ?')
        .bind(await cipher.encrypt(f.content, 'feedbacks.content'), userId, f.date, f.seq),
    )
  }
  if (updates.length > 0) await db.batch(updates)
  return updates.length
}
