export type Bindings = {
  DB: D1Database
  CLERK_SECRET_KEY: string
  /** 任意。ClerkのJWT公開鍵(PEM)。設定するとClerkへの通信なしでトークンを検証する */
  CLERK_JWT_KEY?: string
  ANTHROPIC_API_KEY: string
  /** 任意。カンマ区切りで指定すると、そのClerkユーザー以外はAPIを使えなくなる */
  ALLOWED_USER_IDS?: string
  /** 体重などを暗号化する鍵（32バイトを base64 にしたもの） */
  DATA_KEY: string
  /** 任意。スマホへの通知に使う VAPID の秘密鍵（P-256 の JWK）。なければ通知だけ送らない */
  VAPID_PRIVATE_KEY?: string
  /** 通知の送り主の連絡先（https のURL）。wrangler.jsonc の vars */
  PUSH_SUBJECT?: string
}
