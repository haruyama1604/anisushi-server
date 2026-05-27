import { describe, it, expect } from "vitest";
import { calcTier } from "../db/init";

/**
 * tier 計算のユニットテスト。
 * calcTier は副作用のない純粋関数なので DB を立ち上げずに直接叩ける。
 * 仕様（likes の絶対値による3段階）：
 *   - likes >= 200 → gold（金皿）
 *   - likes >= 80  → silver（銀皿）
 *   - それ以外      → normal（赤皿）
 * 旧実装は likes/views の比率方式だったが、views 自体を削除して絶対値方式に
 * 移行している（README §2 参照）。境界値（80, 200 ちょうど）を意図的にカバーし、
 * 回帰防止に充てる。
 */
describe("calcTier", () => {
  it("likes >= 200 で gold", () => {
    expect(calcTier(200)).toBe("gold");
    expect(calcTier(412)).toBe("gold");
    expect(calcTier(99999)).toBe("gold");
  });

  it("80 <= likes < 200 で silver", () => {
    expect(calcTier(80)).toBe("silver");
    expect(calcTier(100)).toBe("silver");
    expect(calcTier(199)).toBe("silver");
  });

  it("likes < 80 で normal", () => {
    expect(calcTier(0)).toBe("normal");
    expect(calcTier(1)).toBe("normal");
    expect(calcTier(79)).toBe("normal");
  });

  it("境界値：200 ちょうどは gold、199 は silver", () => {
    expect(calcTier(200)).toBe("gold");
    expect(calcTier(199)).toBe("silver");
  });

  it("境界値：80 ちょうどは silver、79 は normal", () => {
    expect(calcTier(80)).toBe("silver");
    expect(calcTier(79)).toBe("normal");
  });

  it("新規投稿（likes=0）は normal でスタートする", () => {
    expect(calcTier(0)).toBe("normal");
  });
});
