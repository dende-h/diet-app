# へるログ

2人で使うダイエット記録Webアプリ。スマホのホーム画面に追加して使う。

- 目標（減量kg・期間）から週ごとの目標を計算し、毎週の体重で残りを割り直す
- 体重は時刻つき（初期値は今の時刻）で1日2回まで記録できる（記録後は変更不可）。計算にはその日いちばん早い時刻の体重を使う
- 体重から維持カロリー（Mifflin-St Jeor式 × 活動量）を出し、その75%を1日の摂取ボーダーにする
- 摂取カロリーを入れるとボーダーとの差が分かる。食事は時刻（初期値は今の時刻）とkcalで記録する
- 食事の写真を送ると、Claude（Sonnet 5.5）がカロリーの数字だけを見積もる（フィードバックはしない。写真は保存しない。1人1日30回まで）
- その日の運動を自由に書いておける（AIフィードバックの材料にするだけで、消費カロリーは計算しない）
- グラフは縦軸がkg（「スタートからの増減」と「体重」を切り替え）、横軸が日付。線は実績の7日平均・毎週調整した目標・当初の計画
- 体重を記録するたびに、Claudeがフィードバックを書く（記録ごとに1回なので1日最大2回）
- アプリを開くときの4桁のPINロック（端末ごとの設定。1分以上ほかのアプリを使って戻ったときも聞く。5回まちがえるとログアウト）

## 構成

| | |
|---|---|
| フロント | React + Vite（PWA） |
| API | Cloudflare Workers（Hono）。`/api/*` だけWorkerが処理し、それ以外は静的アセット |
| DB | Cloudflare D1。全テーブルをClerkのユーザーIDで分離。体重・目標の体重・AIのひとことは暗号化（AES-GCM）して保存 |
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
| `DATA_KEY` | 体重などを暗号化する鍵（32バイトを base64 にしたもの）。下のコマンドで、だれの目にも触れずに作って登録できる |
| `ALLOWED_USER_IDS`（任意） | 2人のClerkユーザーID（カンマ区切り）。設定するとそれ以外のユーザーはAPIを使えない |

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put DATA_KEY
```

- `DATA_KEY` がないとAPIはエラーになる（平文で保存しないため）。
- **`DATA_KEY` を消したり変えたりすると、暗号化したデータは二度と読めなくなる。** シークレットは登録後に読み出せないので、作り直しはできない。
- 暗号化を入れる前に保存された値は、そのユーザーがアプリを開いたときに暗号化し直される。
- これは「DBの画面やSQLで中身が見えない」ための対策で、Workerのコードを書き換えられる人からは守れない。

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
