# へるログ

2人で使うダイエット記録Webアプリ。スマホのホーム画面に追加して使う。

- 目標（減量kg・期間）から週ごとの目標を計算し、毎週の体重で残りを割り直す
- 体重から維持カロリー（Mifflin-St Jeor式 × 活動量）を出し、その75%を1日の摂取ボーダーにする
- 摂取カロリーを入れるとボーダーとの差が分かる
- グラフ画面は数値を出さず線だけ（実績の7日平均・毎週調整した目標・当初の計画）
- その日最初にアプリを開いたとき、Claudeが前日の振り返りフィードバックを1回だけ書く

## 構成

| | |
|---|---|
| フロント | React + Vite（PWA） |
| API | Cloudflare Workers（Hono）。`/api/*` だけWorkerが処理し、それ以外は静的アセット |
| DB | Cloudflare D1。全テーブルをClerkのユーザーIDで分離 |
| 認証 | Clerk（フロントの `<SignIn />`、Workerでセッショントークンを検証） |
| AI | Claude API（`claude-opus-5-5`） |
| CI/CD | GitHub Actions：`main` にpushでテスト → ビルド → D1マイグレーション → デプロイ |

```
src/        画面（今日・履歴・グラフ・設定）
worker/     API・DBアクセス・AIフィードバック
shared/     フロントとWorkerで共通の計算（カロリー、週ごとの目標、グラフの線）
migrations/ D1のスキーマ
```

## 初回セットアップ

### 1. Clerk

1. Clerkでアプリを作る（サインイン方法はメールアドレス＋パスワード、またはメールコード）。
2. 2人がアプリでサインアップしたら、ダッシュボードの **Access mode** を Invite-only（Restricted）にして、それ以上だれも登録できないようにする（Allowlistは有料プランのみ）。あわせてWorkerの `ALLOWED_USER_IDS` に2人のユーザーIDを登録しておくと、ほかのアカウントではAPIを使えない。
3. **API keys** で Publishable key（`pk_...`）と Secret key（`sk_...`）を控える。

### 2. GitHub

リポジトリの **Settings → Secrets and variables → Actions** に以下を登録する。

| 種類 | 名前 | 値 |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflareで「Edit Cloudflare Workers」テンプレートから作り、権限に **D1: Edit** を追加したAPIトークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID |
| Variable | `VITE_CLERK_PUBLISHABLE_KEY` | Clerkの Publishable key |

### 3. Workerのシークレット

最初のデプロイが終わったら、Cloudflareダッシュボードの **Workers & Pages → diet-app → Settings → Variables and Secrets** で「Secret」として登録する（または `npx wrangler secret put <名前>`）。

| 名前 | 値 |
|---|---|
| `CLERK_SECRET_KEY` | Clerkの Secret key |
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー |
| `ALLOWED_USER_IDS`（任意） | 2人のClerkユーザーID（カンマ区切り）。設定するとそれ以外のユーザーはAPIを使えない |

## 開発

```bash
npm install
cp .env.example .env.local        # VITE_CLERK_PUBLISHABLE_KEY を入れる
cp .dev.vars.example .dev.vars    # CLERK_SECRET_KEY, ANTHROPIC_API_KEY を入れる
npm run db:migrate:local
npm run dev                       # http://localhost:5173
```

- `npm test` … 計算ロジックとAIに渡すレポートのテスト
- `npm run build` … 型チェック＋ビルド
- `npm run cf-typegen` … `wrangler.jsonc` を変えたら実行して `worker-configuration.d.ts` を更新
- DBのスキーマを変えるときは `migrations/` に連番のSQLを追加する（デプロイ時に自動適用）
- アイコンを作り直すときは `node scripts/gen-icons.mjs`

## デプロイ

`main` にpushすると GitHub Actions（`.github/workflows/deploy.yml`）が本番に反映する。
