# へるログ

2人で使うダイエット記録Webアプリ。スマホのホーム画面に追加して使う。

- 目標（減量kg・期間）から週ごとの目標を計算し、毎週の体重で残りを割り直す
- 体重は時刻つき（初期値は今の時刻）で1日2回まで記録できる（記録後は変更不可）。計算にはその日いちばん早い時刻の体重を使う
- 体重から維持カロリー（Mifflin-St Jeor式 × 活動量）を出し、その75%を1日の摂取ボーダーにする
- 摂取カロリーを入れるとボーダーとの差が分かる。食事は時刻（初期値は今の時刻）・kcal・内容（任意。AIフィードバックの材料になる）で記録する
- 食事の写真を送ると、Claude（Sonnet 5.5）がカロリーの数字だけを見積もる（フィードバックはしない。写真は保存しない。1人1日10回まで。それ以上は手入力）。写真は選んだだけでは送らず、内容の欄に料理名や補足（「ご飯少なめ」など）を書いてから「計算する」で送り、それも見積もりの参考にする。料理名や量が違っていたら、内容を直して同じ写真で計算し直せる（1回として数える）
- その日の運動を自由に書いておける（AIフィードバックの材料にするだけで、消費カロリーは計算しない）
- グラフは縦軸がkg（「スタートからの増減」と「体重」を切り替え）、横軸が日付。線は実績の7日平均・毎週調整した目標・当初の計画
- 体重を記録するたびに、Claudeがフィードバックを書く（記録ごとに1回なので1日最大2回）
- 朝いちばんの体重を記録すると、前の日の体重・食事・運動と今朝の体重から「昨日の振り返り」をClaudeが書く（その日1回目のひとことの代わり。前の日に何も記録していなければ作らない。記録を足したら1回だけ作り直せる）。朝の体重を量らなかった日は12時（日本時間）に自動で作り、スマホに通知する（Web Push。設定でオン）。通知には記録の中身を入れない
- アプリを開くときの4桁のPINロック（端末ごとの設定。1分以上ほかのアプリを使って戻ったときも聞く。5回まちがえるとログアウト）

## 構成

| | |
|---|---|
| フロント | React + Vite（PWA） |
| API | Cloudflare Workers（Hono）。`/api/*` だけWorkerが処理し、それ以外は静的アセット |
| DB | Cloudflare D1。全テーブルをClerkのユーザーIDで分離。体重・目標の体重・AIのひとこと・振り返りは暗号化（AES-GCM）して保存 |
| 定期実行・通知 | Workers の Cron Trigger で、朝の体重がなかった日の振り返りを昼に作り、Web Push（VAPID、本文は RFC 8291 で暗号化）で通知 |
| 認証 | Clerk（フロントの `<SignIn />`、Workerでセッショントークンを検証） |
| AI | Claude API（AIのひとこと・写真のカロリー判定とも `claude-sonnet-5-5`） |
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
| `VAPID_PRIVATE_KEY` | スマホへの通知に使う鍵（P-256 の秘密鍵の JWK）。下のコマンドで作って登録できる。ないと、振り返りは作るが通知は送らない |

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put DATA_KEY
```

```bash
node -e "const {privateKey}=require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'});process.stdout.write(JSON.stringify(privateKey.export({format:'jwk'})))" | npx wrangler secret put VAPID_PRIVATE_KEY
```

- `VAPID_PRIVATE_KEY` を作り直すと、端末の通知の購読が使えなくなる。そのときは各端末の設定で通知を一度オフにしてからオンにし直す。
- 振り返りを自動で作る時刻は `wrangler.jsonc` の `triggers.crons`（UTC）。日本時間12時に1回、30分後に失敗した分だけもう1回動く。

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
