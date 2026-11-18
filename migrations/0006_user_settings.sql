-- 通知の設定（1人1件）。log_reminder が 1 なら、夜にその日の記録がまだのとき通知する
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  log_reminder INTEGER NOT NULL DEFAULT 0
);
