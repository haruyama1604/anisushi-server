import pino from "pino";

/**
 * アプリ全体で共有する構造化ロガー。
 *
 * モード切替:
 *   - production       … 1行JSON出力（Railway / Datadog 等のログ収集と相性が良い）
 *   - test             … silent（vitest の出力をノイズで埋めない）
 *   - それ以外（dev）   … pino-pretty でカラー整形（ローカル開発のためだけの整形）
 *
 * ログレベルは LOG_LEVEL 環境変数で上書き可能。未設定時はテストのみ silent、
 * それ以外は info。
 */
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
  ...(isProduction || isTest
    ? {} // 本番・テストは整形なし（テストは silent なので transport も不要）
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }),
});
