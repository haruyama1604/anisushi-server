import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db, initDb } from "../db/init";
import { createApp } from "../app";

/**
 * 統合テスト。supertest 経由で実 Express アプリを叩く。
 * - vitest.config.ts の env で TURSO_URL=file::memory:?cache=shared を注入しているため、
 *   本番 Turso には一切触らず in-memory SQLite で完結する。
 * - beforeAll で initDb（スキーマ作成 + 冪等シード）を1回だけ実行。
 * - beforeEach で posts / buckets を全削除（ON DELETE CASCADE で関連テーブルも全部消える）。
 *   これにより各テストは完全に独立した状態で開始できる。
 */
const app = createApp();

beforeAll(async () => {
  await initDb();
});

beforeEach(async () => {
  // posts と buckets を全消し → CASCADE で comments / *_likes / *_replies / bucket_posts も消える。
  // CASCADE の効きが本テストでも実証される副次効果あり。
  await db.execute("DELETE FROM posts");
  await db.execute("DELETE FROM buckets");
});

/** テスト用の匿名認証トークンを払い出すヘルパー。 */
async function newAuth(): Promise<{ token: string; user_id: string }> {
  const res = await request(app).post("/auth/anonymous");
  return res.body;
}

describe("POST /auth/anonymous", () => {
  it("201 で token と user_id を返す", async () => {
    const res = await request(app).post("/auth/anonymous");
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(typeof res.body.user_id).toBe("string");
    expect(res.body.user_id.length).toBeGreaterThan(0);
  });
});

describe("security headers", () => {
  it("X-Powered-By ヘッダはフレームワーク名を晒すので返さない", async () => {
    const res = await request(app).get("/posts");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("posts", () => {
  it("GET /posts は 200 と配列を返す", async () => {
    const res = await request(app).get("/posts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /posts は認証なしだと 401（requireAuth が効いている）", async () => {
    const res = await request(app).post("/posts").send({ content: "hi" });
    expect(res.status).toBe(401);
  });

  it("POST /posts は正常系で 201 + 新規投稿を返す（tier は normal）", async () => {
    const { token } = await newAuth();
    const res = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "テスト投稿", room: "テストルーム" });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    expect(res.body.content).toBe("テスト投稿");
    expect(res.body.room).toBe("テストルーム");
    expect(res.body.likes).toBe(0);
    expect(res.body.views).toBeUndefined(); // views 列は撤去済み
    expect(res.body.tier).toBe("normal"); // likes=0 < 80 なので normal
  });

  it("POST /posts は content が 80 文字超で 400（zod バリデーション）", async () => {
    const { token } = await newAuth();
    const res = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "a".repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("POST /posts/:id/like は 1回目=200、2回目=409（UNIQUE 制約）", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "いいねテスト" });
    const postId = post.body.id;

    const r1 = await request(app)
      .post(`/posts/${postId}/like`)
      .set("Authorization", `Bearer ${token}`);
    expect(r1.status).toBe(200);
    expect(r1.body.likes).toBe(1);

    const r2 = await request(app)
      .post(`/posts/${postId}/like`)
      .set("Authorization", `Bearer ${token}`);
    expect(r2.status).toBe(409);
  });

  it("POST /posts/:id/view は撤去済み（404）", async () => {
    // views を tier 計算から外したため POST /:id/view エンドポイントごと削除。
    // 旧クライアントがまだ叩いてきた場合に 404 になることを保証する。
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "view endpoint removed" });

    const res = await request(app)
      .post(`/posts/${post.body.id}/view`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("DELETE /posts/:id は他人の投稿だと 403", async () => {
    const { token: tokenA } = await newAuth();
    const { token: tokenB } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "A の投稿" });

    const res = await request(app)
      .delete(`/posts/${post.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it("DELETE /posts/:id で CASCADE が効いて関連レコードも全削除される", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "cascade test" });
    const postId = post.body.id;

    // 関連レコードを生やす
    await request(app).post(`/posts/${postId}/like`).set("Authorization", `Bearer ${token}`);
    const comment = await request(app)
      .post(`/posts/${postId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "コメント" });
    expect(comment.status).toBe(201);

    // 親 post 削除
    const del = await request(app)
      .delete(`/posts/${postId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    // DB を直接見て CASCADE 確認
    const count = async (sql: string) => {
      const { rows } = await db.execute({ sql, args: [postId] });
      return Number(rows[0].cnt);
    };
    expect(await count("SELECT COUNT(*) as cnt FROM posts      WHERE id      = ?")).toBe(0);
    expect(await count("SELECT COUNT(*) as cnt FROM post_likes WHERE post_id = ?")).toBe(0);
    expect(await count("SELECT COUNT(*) as cnt FROM comments   WHERE post_id = ?")).toBe(0);
  });
});

describe("comments & replies", () => {
  it("POST + GET /posts/:id/comments のラウンドトリップ（replies は空配列）", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "コメ親" });
    const postId = post.body.id;

    const c = await request(app)
      .post(`/posts/${postId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "hello" });
    expect(c.status).toBe(201);

    const g = await request(app).get(`/posts/${postId}/comments`);
    expect(g.status).toBe(200);
    expect(g.body).toHaveLength(1);
    expect(g.body[0].text).toBe("hello");
    expect(g.body[0].replies).toEqual([]); // N+1 解消 + 空配列保証
  });

  it("POST /comments/:id/replies は親 post を like していないと 403（返信ガード）", async () => {
    const { token: tokenA } = await newAuth();
    const { token: tokenB } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ content: "返信ガードテスト" });
    const c = await request(app)
      .post(`/posts/${post.body.id}/comments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ text: "親コメ" });

    // B は post を like していない
    const r = await request(app)
      .post(`/comments/${c.body.id}/replies`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ text: "返信したい" });
    expect(r.status).toBe(403);
  });

  it("POST /comments/:id/replies は親 post を like していれば 201", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "返信OKテスト" });
    const c = await request(app)
      .post(`/posts/${post.body.id}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "親コメ" });
    await request(app)
      .post(`/posts/${post.body.id}/like`)
      .set("Authorization", `Bearer ${token}`);

    const r = await request(app)
      .post(`/comments/${c.body.id}/replies`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "返信" });
    expect(r.status).toBe(201);
    expect(r.body.text).toBe("返信");
  });

  it("DELETE /comments/:id で CASCADE が comment_replies / comment_likes も削除する", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "comment cascade" });
    const postId = post.body.id;
    const c = await request(app)
      .post(`/posts/${postId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "親" });
    const commentId = c.body.id;

    // like + reply で関連レコードを作る
    await request(app).post(`/posts/${postId}/like`).set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/comments/${commentId}/like`)
      .set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/comments/${commentId}/replies`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "返信" });

    // コメント削除
    const del = await request(app)
      .delete(`/comments/${commentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const count = async (sql: string) => {
      const { rows } = await db.execute({ sql, args: [commentId] });
      return Number(rows[0].cnt);
    };
    expect(await count("SELECT COUNT(*) as cnt FROM comments        WHERE id         = ?")).toBe(0);
    expect(await count("SELECT COUNT(*) as cnt FROM comment_likes   WHERE comment_id = ?")).toBe(0);
    expect(await count("SELECT COUNT(*) as cnt FROM comment_replies WHERE comment_id = ?")).toBe(0);
  });
});

describe("buckets", () => {
  it("POST /buckets は 201 + 新規箱を返す", async () => {
    const { token } = await newAuth();
    const res = await request(app)
      .post("/buckets")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "お気に入り" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("お気に入り");
  });

  it("DELETE /buckets/:id で CASCADE が bucket_posts を削除", async () => {
    const { token } = await newAuth();
    const post = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "bucket cascade" });
    const bucket = await request(app)
      .post("/buckets")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "テスト箱" });
    const bucketId = bucket.body.id;

    await request(app)
      .post(`/buckets/${bucketId}/posts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ post_id: post.body.id });

    // 箱削除
    const del = await request(app)
      .delete(`/buckets/${bucketId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const { rows } = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM bucket_posts WHERE bucket_id = ?",
      args: [bucketId],
    });
    expect(Number(rows[0].cnt)).toBe(0);
  });
});
