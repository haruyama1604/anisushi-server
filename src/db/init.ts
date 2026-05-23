import { createClient } from "@libsql/client";

// 環境変数が設定されているかチェック
if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
  throw new Error("Missing TURSO_URL or TURSO_TOKEN in environment variables.");
}

export const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
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
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      spoiler    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL DEFAULT 'system',
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
    `CREATE TABLE IF NOT EXISTS post_views (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS buckets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    )`,
  ], "write");

  await db.batch([
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_post_likes ON post_likes (post_id, user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_post_views ON post_views (post_id, user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_comment_likes ON comment_likes (comment_id, user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bucket_posts ON bucket_posts (bucket_id, post_id)",
  ], "write");

  const { rows: countRows } = await db.execute("SELECT COUNT(*) as cnt FROM posts");
  const cnt = Number(countRows[0].cnt);
  
  if (cnt === 0) {
    const p1 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["エレンの決断は正しかったのか？", 350, 490, "system", "キャラ考察"] });
    const p2 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["鬼滅の刃3期の作画がやばい", 187, 467, "system", "最新話速報"] });
    const p3 = await db.execute({ sql: "INSERT INTO posts (content, likes, views, user_id, room) VALUES (?, ?, ?, ?, ?)", args: ["ルフィのギア5、原作とアニメどっちが好き？", 45, 300, "system", "キャラ考察"] });

    if (!p1.lastInsertRowid || !p2.lastInsertRowid || !p3.lastInsertRowid) {
      throw new Error("Failed to insert seed posts");
    }
    const p1Id = Number(p1.lastInsertRowid);
    const p2Id = Number(p2.lastInsertRowid);
    const p3Id = Number(p3.lastInsertRowid);

    await db.batch([
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [p1Id, "この考察最高すぎる", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [p1Id, "アニメ見直した", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [p2Id, "ufotableは毎回やばい", "system"] },
      { sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [p3Id, "アニメのギア5は笑いすぎた", "system"] },
    ], "write");
  }

  // 追加シード（運営投稿）。既に同じcontentがsystemユーザーで存在する場合はスキップ（冪等）。
  // 既存3件の初期投稿に加え、各ルームに運営の話題提起を1件ずつ用意する。
  const additionalSeeds: { content: string; room: string }[] = [
    { content: "マキマに提供された「普通」の生活で思考停止するデンジ。彼にとって普通とは、他人に飼われるための首輪だった構造がエグい。", room: "キャラ考察" },
    { content: "闇の悪魔戦以降、トラウマを共有して寄り添い合う二人が尊すぎる。恋愛を超越して完全に「家族」の領域に達してるよね。", room: "デンジ×パワー" },
    { content: "アキが「デンジ達に死んでほしくない」と復讐を諦めた直後に、最悪の形（銃の魔人）で戦わせるタツキ先生の人の心のなさ（褒め言葉）。", room: "藤本タツキ論" },
    { content: "暗殺者として育てられたレゼがデンジに勉強を教えるシーン。もし普通の女の子として生きられたら、というifの人生を追体験してそうで切ない。", room: "名シーン保管庫" },
    { content: "人類の革新を叫ぶカリスマでありながら、本質はアムロへの対抗心とララァへのマザコンに縛られ続けた人間臭さが最高に魅力的。", room: "シャア考察" },
    { content: "ジオン系のモノアイや駆動系が、戦後アナハイムを通じて連邦系MSに混ざり合っていく設定資料を眺めるだけで一晩明かせる。", room: "MS設定談義" },
    { content: "単なる善悪二元論じゃなく、双方に大義と腐敗があるのが泥臭くて良い。オデッサ作戦前後の補給線の攻防とか設定が細かくて痺れる。", room: "一年戦争" },
    { content: "「嘘はとびきりの愛（プロフェッショナル）」を貫き、最期に本物の「愛してる」を見つけたアイ。彼女の眩しさと孤独がこの作品のすべて。", room: "アイ伝説" },
    { content: "純粋だったルビーの瞳に復讐の黒い星が宿った瞬間のゾクゾク感。お兄ちゃん（アクア）とは違うベクトルの狂気を感じて目が離せない。", room: "ルビー応援" },
    { content: "漫画業界のシステムや舞台のギャラ事情、SNS炎上の生々しさなど、現代芸能界のリアルな闇の描き方が容赦なさすぎて毎回震える。", room: "芸能界リアル談" },
  ];

  for (const s of additionalSeeds) {
    const { rows } = await db.execute({
      sql: "SELECT 1 FROM posts WHERE content = ? AND user_id = 'system'",
      args: [s.content],
    });
    if (rows[0]) continue;
    await db.execute({
      sql: "INSERT INTO posts (content, user_id, room) VALUES (?, 'system', ?)",
      args: [s.content, s.room],
    });
  }
}