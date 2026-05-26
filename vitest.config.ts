import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // テスト中は env を注入して、in-memory SQLite と固定 JWT 秘密鍵を使う。
    // - `file::memory:?cache=shared` … libsql の native ドライバで in-memory DB を起動。
    //   `?cache=shared` を付けることで、同一プロセス内の複数コネクションが同じ DB を共有する。
    // - JWT_SECRET … 本番秘密と分けるため、テスト用の十分長い文字列。
    env: {
      TURSO_URL: "file::memory:?cache=shared",
      TURSO_TOKEN: "test-unused-for-file-url",
      JWT_SECRET: "test-secret-key-for-vitest-only-do-not-use-in-production",
      NODE_ENV: "test",
    },
    // 1つの worker に固定して、in-memory DB を1個に揃える（並列ファイル間で衝突しないように）
    fileParallelism: false,
  },
});
