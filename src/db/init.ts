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

// 既存DBに ON DELETE CASCADE が入っているかを判定する。
// SQLite は ALTER で FK 制約を後から付けられないため、
// 入っていなければ migrateToCascade() でテーブル再構築を行う。
async function isCascadeMigrationNeeded(): Promise<boolean> {
  const { rows } = await db.execute("PRAGMA foreign_key_list(comments)");
  // 旧スキーマでは on_delete='NO ACTION'、新スキーマでは 'CASCADE'。
  // テーブル自体が無い（初回起動）場合は rows.length === 0 だが、
  // その後の CREATE TABLE で CASCADE 付きの新スキーマが作られるので migration は不要。
  if (rows.length === 0) return false;
  return !rows.some(
    (r) => String(r.from) === "post_id" && String(r.on_delete) === "CASCADE"
  );
}

// 既存DBのテーブルを ON DELETE CASCADE 付きで作り直す。
// SQLite は ALTER TABLE で FK 制約を変更できない (公式の標準手順は
// https://sqlite.org/lang_altertable.html#otheralter)。よって:
//   1. *_new テーブルを CASCADE 付きで作る
//   2. データを COPY する
//   3. 旧テーブルを DROP
//   4. *_new を旧名に RENAME
// `PRAGMA foreign_keys = OFF` はトランザクション内では no-op なので、
// PRAGMA + BEGIN/COMMIT + PRAGMA を 1 HTTP リクエスト = 1 コネクションで
// 流すために `executeMultiple` を使う。
async function migrateToCascade(): Promise<void> {
  if (!(await isCascadeMigrationNeeded())) return;

  console.log("[migration] Rebuilding tables with ON DELETE CASCADE...");

  await db.executeMultiple(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    CREATE TABLE comments_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL DEFAULT 'system',
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    INSERT INTO comments_new (id, post_id, text, user_id, likes, created_at)
      SELECT id, post_id, text, user_id, likes, created_at FROM comments;
    DROP TABLE comments;
    ALTER TABLE comments_new RENAME TO comments;

    CREATE TABLE post_likes_new (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT    NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    INSERT INTO post_likes_new (id, post_id, user_id)
      SELECT id, post_id, user_id FROM post_likes;
    DROP TABLE post_likes;
    ALTER TABLE post_likes_new RENAME TO post_likes;

    CREATE TABLE post_views_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    INSERT INTO post_views_new (id, post_id, user_id, created_at)
      SELECT id, post_id, user_id, created_at FROM post_views;
    DROP TABLE post_views;
    ALTER TABLE post_views_new RENAME TO post_views;

    CREATE TABLE comment_likes_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );
    INSERT INTO comment_likes_new (id, comment_id, user_id)
      SELECT id, comment_id, user_id FROM comment_likes;
    DROP TABLE comment_likes;
    ALTER TABLE comment_likes_new RENAME TO comment_likes;

    CREATE TABLE comment_replies_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );
    INSERT INTO comment_replies_new (id, comment_id, text, user_id, created_at)
      SELECT id, comment_id, text, user_id, created_at FROM comment_replies;
    DROP TABLE comment_replies;
    ALTER TABLE comment_replies_new RENAME TO comment_replies;

    CREATE TABLE bucket_posts_new (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_id INTEGER NOT NULL,
      post_id   INTEGER NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id)   REFERENCES posts(id)   ON DELETE CASCADE
    );
    INSERT INTO bucket_posts_new (id, bucket_id, post_id)
      SELECT id, bucket_id, post_id FROM bucket_posts;
    DROP TABLE bucket_posts;
    ALTER TABLE bucket_posts_new RENAME TO bucket_posts;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_likes    ON post_likes    (post_id,    user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_views    ON post_views    (post_id,    user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_comment_likes ON comment_likes (comment_id, user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bucket_posts  ON bucket_posts  (bucket_id,  post_id);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);

  console.log("[migration] Done.");
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
    `CREATE TABLE IF NOT EXISTS buckets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL DEFAULT 'system',
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS comment_likes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS post_likes (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT    NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS post_views (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bucket_posts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_id INTEGER NOT NULL,
      post_id   INTEGER NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id)   REFERENCES posts(id)   ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS comment_replies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      text       TEXT    NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    )`,
  ], "write");

  // 既存DB（CASCADE なしのスキーマ）が残っていれば作り直す。idempotent。
  await migrateToCascade();

  await db.batch([
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_post_likes    ON post_likes    (post_id,    user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_post_views    ON post_views    (post_id,    user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_comment_likes ON comment_likes (comment_id, user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bucket_posts  ON bucket_posts  (bucket_id,  post_id)",
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

  // 追加シード（運営投稿+コメント）。content/comment text と user_id='system' で
  // 既存判定して、無ければ INSERT する冪等処理。再デプロイで重複しない。
  const additionalSeeds: { content: string; room: string; comments: string[] }[] = [
    {
      content: "マキマに提供された「普通」の生活で思考停止するデンジ。彼にとって普通とは、他人に飼われるための首輪だった構造がエグい。",
      room: "キャラ考察",
      comments: [
        "ほんとこれ。普通の生活を手に入れたはずなのに、どんどん生気を失っていくデンジの描写がリアルでゾッとした。",
        "自由になったと思わせて、実はマキマさんの手のひらの上っていうのが絶望感ハンパないよね。",
      ],
    },
    {
      content: "闇の悪魔戦以降、トラウマを共有して寄り添い合う二人が尊すぎる。恋愛を超越して完全に「家族」の領域に達してるよね。",
      room: "デンジ×パワー",
      comments: [
        "二人で一緒のベッドで寝るシーン、下心が一切消えてて本当に精神的な支え合ってて泣ける。",
        "恋愛関係にならないからこそ、お互いにとって唯一無二の掛け替えのない存在になったのが尊すぎる……！",
      ],
    },
    {
      content: "アキが「デンジ達に死んでほしくない」と復讐を諦めた直後に、最悪の形（銃の魔人）で戦わせるタツキ先生の人の心のなさ（褒め言葉）。",
      room: "藤本タツキ論",
      comments: [
        "雪合戦の幻覚を見せながら戦わせるの、マジで鬼畜の所業すぎて初読のときトラウマになったわ。",
        "読者のメンタルをズタズタにしてくるけど、その最悪な展開が最高に面白いからタツキ先生信者はやめられない。",
      ],
    },
    {
      content: "暗殺者として育てられたレゼがデンジに勉強を教えるシーン。もし普通の女の子として生きられたら、というifの人生を追体験してそうで切ない。",
      room: "名シーン保管庫",
      comments: [
        "夜のプールとか花火のシーンの、刹那の青春感が眩しすぎてその後の展開とのギャップに大号泣した。",
        "レゼが最後に「私も学校行ったことないの」って呟くの、普通の幸せを知らない二人が共鳴してて切なすぎる。",
      ],
    },
    {
      content: "人類の革新を叫ぶカリスマでありながら、本質はアムロへの対抗心とララァへのマザコンに縛られ続けた人間臭さが最高に魅力的。",
      room: "シャア考察",
      comments: [
        "逆シャアの最後のセリフとか、格好いいのに最高に情けなくて、だからこそ何十年経っても愛されるキャラなんだと思う。",
        "全人類を導く総帥の器と、プライドの高い拗らせたおじさんが同居してるのがシャアの味わい深いところ。",
      ],
    },
    {
      content: "ジオン系のモノアイや駆動系が、戦後アナハイムを通じて連邦系MSに混ざり合っていく設定資料を眺めるだけで一晩明かせる。",
      room: "MS設定談義",
      comments: [
        "ハイザックの「連邦なのにモノアイ」っていう折衷案みたいなデザイン、過渡期の泥臭さがあって大好物です。",
        "アナハイムが裏で両方に武器流して技術吸収してるの、宇宙世紀の闇だしリアルな兵器産業って感じで最高。",
      ],
    },
    {
      content: "単なる善悪二元論じゃなく、双方に大義と腐敗があるのが泥臭くて良い。オデッサ作戦前後の補給線の攻防とか設定が細かくて痺れる。",
      room: "一年戦争",
      comments: [
        "前線の兵士はどっちも必死なのに、上層部の政治的な思惑で戦況が引っ掻き回される描写がめちゃくちゃリアル。",
        "補給が途絶えたらどれだけ強いMSもただの鉄屑になるっていう、ミリタリー寄りのハードな設定が大人に刺さる。",
      ],
    },
    {
      content: "「嘘はとびきりの愛（プロフェッショナル）」を貫き、最期に本物の「愛してる」を見つけたアイ。彼女の眩しさと孤独がこの作品のすべて。",
      room: "アイ伝説",
      comments: [
        "1巻であんなに綺麗に物語を爆発させて、未だに作品全体の呪縛であり光であり続けるアイのカリスマ性が狂おしい。",
        "最後に「この嘘はとびきりの愛」じゃなくて、本当の言葉として子どもたちに伝えられて救われたと思いたい……。",
      ],
    },
    {
      content: "純粋だったルビーの瞳に復讐の黒い星が宿った瞬間のゾクゾク感。お兄ちゃん（アクア）とは違うベクトルの狂気を感じて目が離せない。",
      room: "ルビー応援",
      comments: [
        "あの天真爛漫だったルビーが、ママと同じ瞳（でも色は黒）になった時の鳥肌がヤバかった。復讐劇の始まりって感じ。",
        "アクアの冷徹な復讐劇とは違って、ルビーは感情がドロドロに燃え上がってる感じがして別の怖さがあるよね。",
      ],
    },
    {
      content: "漫画業界のシステムや舞台のギャラ事情、SNS炎上の生々しさなど、現代芸能界のリアルな闇の描き方が容赦なさすぎて毎回震える。",
      room: "芸能界リアル談",
      comments: [
        "ネットニュースの切り取り方とかSNSの誹謗中傷の描写、生々しすぎてニュース見る目が変わるレベル。",
        "原作者と脚本家の板挟み問題とか、2.5次元の「役者同士のバチバチ感」とか、よくここまで取材して描けるなと感心する。",
      ],
    },
  ];

  for (const s of additionalSeeds) {
    // post を既存判定 → 無ければ INSERT、ある場合は既存IDを取得（後でコメントを紐づけるため）
    const { rows: existing } = await db.execute({
      sql: "SELECT id FROM posts WHERE content = ? AND user_id = 'system'",
      args: [s.content],
    });
    let postId: number;
    if (existing[0]) {
      postId = Number(existing[0].id);
    } else {
      const inserted = await db.execute({
        sql: "INSERT INTO posts (content, user_id, room) VALUES (?, 'system', ?)",
        args: [s.content, s.room],
      });
      postId = Number(inserted.lastInsertRowid);
    }

    // 各コメントも冪等にINSERT（既存テキストがあればスキップ）
    for (const text of s.comments) {
      const { rows: existingComment } = await db.execute({
        sql: "SELECT 1 FROM comments WHERE post_id = ? AND text = ? AND user_id = 'system'",
        args: [postId, text],
      });
      if (existingComment[0]) continue;
      await db.execute({
        sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, 'system')",
        args: [postId, text],
      });
    }
  }
}