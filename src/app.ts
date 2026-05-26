import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import authRouter from "./routes/auth";
import postsRouter from "./routes/posts";
import commentsRouter from "./routes/comments";
import bucketsRouter from "./routes/buckets";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./logger";

/**
 * Express app を組み立てて返すファクトリ。
 * 本番起動 (`index.ts`) からも supertest からも同じ app を呼べるように、
 * `app.listen` と DB 初期化は呼び出し側の責務にしてある。
 */
export function createApp() {
  const app = express();
  // Railway などのリバースプロキシ越しでも req.ip を正しく取れるようにする。
  // 1 hop だけ信用する設定。`true` だと X-Forwarded-For を詐称されると IP ベース
  // レート制限が無力化されるため、本番想定の安全値として 1 を選ぶ。
  app.set("trust proxy", 1);

  // 全リクエストを構造化ログに記録。
  // - req.log が生え、各 handler から `req.log.info(...)` で文脈付きログが出せる
  // - レスポンスの status に応じて自動で level が決まる（2xx/3xx=info、4xx=warn、5xx=error）
  // - ログレベルは ./logger に集約しているため、テスト時は silent で抑制される
  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: ["https://anisushi-client.vercel.app", "http://localhost:5173"] }));
  app.use(express.json());

  app.use("/auth", authRouter);
  app.use("/posts", postsRouter);
  app.use(commentsRouter);
  app.use("/buckets", bucketsRouter);
  app.use(errorHandler);

  return app;
}
