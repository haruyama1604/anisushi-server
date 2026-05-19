import { Router } from "express";
import { signAnonymousToken } from "../middleware/auth";

const router = Router();

/**
 * POST /auth/anonymous
 * 認証ヘッダ不要。新規匿名ユーザーIDを払い出し、JWT を返す。
 * クライアントは初回起動時に1度だけ呼び、localStorage に token を永続化する。
 */
router.post("/anonymous", async (_req, res) => {
  const { token, user_id } = signAnonymousToken();
  res.status(201).json({ token, user_id });
});

export default router;
