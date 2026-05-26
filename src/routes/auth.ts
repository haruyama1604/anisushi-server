import { Router } from "express";
import { signAnonymousToken } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";

const router = Router();

/**
 * POST /auth/anonymous
 * 認証ヘッダ不要。新規匿名ユーザーIDを払い出し、JWT を返す。
 * クライアントは初回起動時に1度だけ呼び、localStorage に token を永続化する。
 *
 * authLimiter で 1 時間 / IP あたり 10 リクエストに制限している
 * （JWT 量産による偽 user_id 大量生成・署名 CPU 消費 DoS の対策）。
 */
router.post("/anonymous", authLimiter, async (_req, res) => {
  const { token, user_id } = signAnonymousToken();
  res.status(201).json({ token, user_id });
});

export default router;
