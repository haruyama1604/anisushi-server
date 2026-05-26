import { describe, it, expect } from "vitest";
import { calcTier } from "../db/init";

/**
 * tier 計算のユニットテスト。
 * calcTier は副作用のない純粋関数なので DB を立ち上げずに直接叩ける。
 * 仕様：
 *   - views = 0 → normal（ゼロ除算回避）
 *   - likes/views >= 0.7 → gold
 *   - likes/views >= 0.4 → silver
 *   - それ以外          → normal
 * 境界値（0.4、0.7 ちょうど）を意図的にカバーし、回帰防止に充てる。
 */
describe("calcTier", () => {
  it("views = 0 のときは likes に関係なく normal（ゼロ除算回避）", () => {
    expect(calcTier(0, 0)).toBe("normal");
    expect(calcTier(100, 0)).toBe("normal");
  });

  it("likes/views >= 0.7 で gold", () => {
    expect(calcTier(70, 100)).toBe("gold");
    expect(calcTier(100, 100)).toBe("gold");
    expect(calcTier(999, 1000)).toBe("gold");
  });

  it("0.4 <= likes/views < 0.7 で silver", () => {
    expect(calcTier(40, 100)).toBe("silver");
    expect(calcTier(50, 100)).toBe("silver");
    expect(calcTier(69, 100)).toBe("silver");
  });

  it("likes/views < 0.4 で normal", () => {
    expect(calcTier(0, 100)).toBe("normal");
    expect(calcTier(1, 100)).toBe("normal");
    expect(calcTier(39, 100)).toBe("normal");
  });

  it("境界値：0.7 ちょうどは gold", () => {
    expect(calcTier(7, 10)).toBe("gold");
  });

  it("境界値：0.4 ちょうどは silver", () => {
    expect(calcTier(4, 10)).toBe("silver");
  });

  it("境界値：0.7 直前は silver、0.4 直前は normal", () => {
    expect(calcTier(699, 1000)).toBe("silver");
    expect(calcTier(399, 1000)).toBe("normal");
  });
});
