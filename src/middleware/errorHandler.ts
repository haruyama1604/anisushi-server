import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isDev = process.env.NODE_ENV !== "production";
  // pino-http が各リクエストに req.log を生やしているので、リクエストID付きで
  // 構造化ログに記録する。req.log が無い経路（テスト等）への保険として ?. を使う。
  req.log?.error({ err }, "Unhandled error in request handler");
  res.status(500).json({
    error: "Internal server error",
    ...(isDev && { detail: err instanceof Error ? err.message : String(err) }),
  });
}
