import { defineConfig } from 'vitest/config'

// vite.config.ts の Cloudflare プラグインを読み込まないよう、テスト用の設定を分ける
export default defineConfig({
  test: { include: ['shared/**/*.test.ts', 'worker/**/*.test.ts'] },
})
