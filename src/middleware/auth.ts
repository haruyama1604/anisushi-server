import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error("Missing JWT_SECRET in environment variables.");
}

// 匿名トークンの有効期限。長め（1年）にして「実質永続」のUXを保ちつつ、
// 漏洩時の被害範囲を有限化する。
const TOKEN_TTL = "365d";

type AuthPayload = {
  sub: string;   // user_id
  anon: boolean; // 匿名フラグ（将来の認証拡張時の識別用）
  iat?: number;
  exp?: number;
};

// Express の Request 型に user を生やす
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string };
  }
}

/**
 * 新規匿名ユーザー用のJWTを発行する。
 * 1ユーザー = 1UUID で永続化される（クライアントがlocalStorageに保存）。
 */
export function signAnonymousToken(): { token: string; user_id: string } {
  const user_id = randomUUID();
  const token = jwt.sign({ sub: user_id, anon: true }, SECRET!, { expiresIn: TOKEN_TTL });
  return { token, user_id };
}

/**
 * 必須認証ミドルウェア。Authorization: Bearer <token> ヘッダが必要。
 * 検証成功時に req.user = { id } をセットする。
 * 失敗時は 401 を返す。
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, SECRET!) as AuthPayload;
    if (!payload.sub) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }
    req.user = { id: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * 任意認証ミドルウェア。トークンがあれば req.user をセットし、無くてもエラーにしない。
 * GET系の公開エンドポイントで「ログイン中なら liked_by_user を付ける」用途に使う。
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, SECRET!) as AuthPayload;
    if (payload.sub) req.user = { id: payload.sub };
  } catch {
    // 無効トークンでも 401 にせず、未認証として続行
  }
  next();
}
