import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny, z } from "zod";

/**
 * リクエストボディを zod スキーマで検証するミドルウェア。
 * - パース失敗時は 400 を返し、フィールド単位の詳細を含める
 * - 成功時は req.body をパース済み（trim・default 適用済み）の値で置き換える
 *
 * 使い方:
 *   router.post("/", requireAuth, validateBody(CreatePostBody), async (req, res) => {
 *     const { content, room, spoiler } = req.body; // 型推論済み
 *   });
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data as z.infer<T>;
    next();
  };
}
