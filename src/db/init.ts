import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_TOKEN!,
});

export function calcTier(likes: number, views: number): string {
  if (views === 0) return "normal";
  const rate = likes / views;
  if (rate >= 0.7) return "gold";
  if (rate >= 0.4) return "silver";
  return "normal";
}

export async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT    NOT NULL,
      likes      INTEGER NOT NULL DEFAULT 0,
      views      INTEGER NOT NULL DEFAULT 0,
      user_id    TEXT    NOT NULL DEFAULT 'system',
      room       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      spoiler    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL DEFAULT 'system',
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS comment_likes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    )`,
    `CREATE TABLE IF NOT EXISTS post_likes (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT    NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS buckets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS bucket_posts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_id INTEGER NOT NULL,
      post_id   INTEGER NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id),
      FOREIGN KEY (post_id)   REFERENCES posts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS comment_replies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    )`,
  ], "write");

  const { rows: countRows } = await db.execute("SELECT COUNT(*) as cnt FROM posts");
  const cnt = Number(countRows[0].cnt);
  if (cnt === 0) {
    const p1 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["エレンの決断は正しかったのか？", 342, 490, "system", "キャラ考察"] });
    const p2 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["鬼滅の刃3期の作画がやばい", 187, 467, "system", "最新話速報"] });
    const p3 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["ルフィのギア5、原作とアニメどっちが好き？", 45, 300, "system", "キャラ考察"] });

    await db.batch([
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [Number(p1.lastInsertRowid), "この考察最高すぎる", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [Number(p1.lastInsertRowid), "アニメ見直した", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [Number(p2.lastInsertRowid), "ufotableは毎回やばい", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [Number(p3.lastInsertRowid), "アニメのギア5は笑いすぎた", "system"] },
    ], "write");
  }
}
