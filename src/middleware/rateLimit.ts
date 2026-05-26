import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

const isTest = process.env.NODE_ENV === "test";

/**
 * 全 limiter 共通の基本設定。
 * - standardHeaders: 'draft-7' で RFC 9239 準拠の `RateLimit-*` ヘッダを返す
 *   → 賢いクライアントは事前にレート枯渇を察知して自前で間引ける
 * - skip でテスト中は完全にバイパス。22 テストが limit に当たって落ちることを防ぐ
 * - 429 のレスポンス形を errorHandler と揃えて JSON で返す
 */
const baseOptions: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: "Too many requests, please try again later" },
};

/**
 * `/auth/anonymous` 専用の厳しめ IP ベース limiter。
 *
 * 匿名トークン発行は認証不要なので、無制限に許すと:
 *   - 自動化スクリプトで匿名 user_id を量産 → 大量の偽 like / view 投票
 *   - JWT 量産による署名生成 CPU 消費 (DoS)
 * のリスクがある。1 時間 / IP あたり 10 リクエストに制限する。
 *
 * IPv6 環境を正しく扱うため、`ipKeyGenerator` 経由でキーを生成する
 * (素の req.ip では IPv6 のサブネット集約が効かず警告が出る)。
 */
export const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000, // 1 時間
  limit: 10,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
});

/**
 * 書き込み系エンドポイント (POST 投稿・コメント・返信・箱・いいね) 用の
 * **ユーザー単位** limiter。
 *
 * 1 分 / ユーザーあたり 60 リクエスト。通常利用 (スクロールしながら数件いいね) には十分で、
 * ボットによる投稿スパムを防ぐ目安。
 *
 * keyGenerator を user_id にすることで:
 *   - NAT 経由で同じ IP を共有する複数ユーザーが誤って巻き込まれない
 *   - 同じユーザーが複数 IP (モバイル <-> Wi-Fi) を移動しても合算で制限される
 *
 * requireAuth の **後** にチェーンする前提 (req.user.id が存在することを期待)。
 * 万一 user が居なければ IP にフォールバックする。
 */
export const writeLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 分
  limit: 60,
  keyGenerator: (req: Request) =>
    req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});
