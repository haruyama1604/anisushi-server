import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isDev = process.env.NODE_ENV !== "production";
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({
    error: "Internal server error",
    ...(isDev && { detail: err instanceof Error ? err.message : String(err) }),
  });
}
