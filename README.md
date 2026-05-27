# anisushi-server

アニメ特化の回転寿司SNS「あにすし」のバックエンドAPI。

## 本番URL

https://anisushi-server-production.up.railway.app/posts

## 技術スタック

| 技術 | 用途 | 選定理由 |
|---|---|---|
| TypeScript / Node.js | 言語・ランタイム | 型安全性とフロント（React/TS）との共通化 |
| Express 5 | Webフレームワーク | async/await の例外を自動的に error middleware に流せる（手動 try-catch を全廃できる） |
| Turso (libsql) | クラウドSQLite | エッジロケーションから低レイテンシで読める、無料枠が広い、SQLiteとAPI互換で学習コスト低 |
| jsonwebtoken | 認証 | HS256 で署名検証、ステートレスな本人判定を実現 |
| zod | バリデーション | スキーマから TS 型を生成、宣言的に書ける |
| Railway | デプロイ・ホスティング | git push 連動で CD が組める、無料枠あり |
| vitest / supertest | テスト | Vite ベースで起動が速く、`supertest` で実 Express app を HTTP レベルで叩ける。in-memory SQLite と組み合わせて本番DBに触れず完結 |
| pino / pino-http | 構造化ロガー | Node 系で最速クラス。本番は1行JSONで Railway のログ検索と相性が良く、`pino-http` で各リクエストに `req.log` が生え、ログにリクエスト文脈（reqId / method / url / 応答ms）が自動付与される |
| express-rate-limit | レート制限 | `/auth/anonymous` は IP ベースで厳しめに、書き込み系はユーザー単位で。トークン量産 DoS と投稿スパムをミドルウェア1行で防げる |

## 設計上の判断

### 1. 匿名 JWT 認証を採用

メール+パスワードや OAuth ではなく、**初回起動時に匿名ユーザーIDを払い出して JWT で永続化**する方式を選んだ。

- アプリのコンセプトが「気軽に流れる皿を取る」匿名コミュニティで、サインアップフローはUXを損なう
- それでも「クライアントが他人の user_id を詐称できる」という旧実装の脆弱性は塞ぐ必要があった
- サーバが署名検証した JWT の `sub` クレームのみを `user_id` とすることで、なりすましを不可能にした

### 2. tier ロジックは likes の絶対値で都度算出

各投稿の `tier`（金皿/銀皿/赤皿）はリクエスト時に **likes だけ** から算出する（`likes>=200` gold / `>=80` silver / それ未満 normal）。

- DB に保存しない理由：likes は変動するため、保存した瞬間に古くなる
- 旧実装は `likes/views` 比率方式だったが、views を tier に組み込むと「views 水増し攻撃」を生むため `post_views` 中間テーブル等の防御策が必要になっていた。**過剰設計に気付き views ごと撤去**（「コード品質に関する取り組み §2」参照）

### 3. N+1 を許容しない

コメント取得時、各コメントの返信を個別 fetch すると N+1 になる。
これは `WHERE comment_id IN (?, ?, ...)` のバッチクエリ + `Promise.all` での並列化で **コメント数に依らず2クエリ**に抑えている。

## データモデル

```
posts (親)       ──┬── post_likes      (post_id, user_id) UNIQUE
                   ├── comments      ──┬── comment_likes   (comment_id, user_id) UNIQUE
                   │                   └── comment_replies
                   └── bucket_posts ───┐
buckets (親)     ─────────────────────┴── bucket_posts     (bucket_id, post_id) UNIQUE
```

矢印は親→子の FK 関係。すべての子テーブル FK には `ON DELETE CASCADE` を付与しており、論理削除はせず関連レコードの削除は DB エンジンに委譲している（詳細は後述「コード品質に関する取り組み」§6）。すべてのテーブルに `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` を持たせ、ISO 8601 UTC で保存している。

## 認証フロー

```
1. クライアント初回起動
   POST /auth/anonymous
   → サーバが UUID 発行 + JWT 署名 (HS256, exp: 365d)
   → { token, user_id } 返却

2. クライアントは token を localStorage に永続化

3. 以降のリクエスト
   Authorization: Bearer <token>
   → サーバ middleware が署名検証 → req.user.id を取り出す
   → 全 route で user_id ソースとして使用（クライアント送信値は無視）

4. 401 が返った場合（期限切れ・SECRET ローテーション）
   → クライアントが自動で /auth/anonymous を呼び直して1回だけリトライ
```

`requireAuth` と `optionalAuth` の2種類を用意し、書き込み系は前者、公開GET（`/posts`、`/comments`）は後者を使う（後者はログイン中なら `liked_by_user` を付与する目的）。

## APIエンドポイント一覧

### 認証

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| POST | `/auth/anonymous` | - | 匿名ユーザーIDを発行しJWTを返す |

### 投稿

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/posts` | optional | 投稿一覧（tier付き） |
| POST | `/posts` | required | 投稿作成（content<=80字） |
| DELETE | `/posts/:id` | required | 投稿削除（本人のみ） |
| GET | `/posts/liked` | required | 自分がいいねした投稿ID一覧 |
| POST | `/posts/:id/like` | required | いいね |
| DELETE | `/posts/:id/like` | required | いいね取り消し |

### コメント・返信

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/posts/:id/comments` | optional | コメント一覧（replies ネスト・liked_by_user 付き） |
| POST | `/posts/:id/comments` | required | コメント追加（text<=80字） |
| DELETE | `/comments/:id` | required | コメント削除（本人のみ） |
| POST | `/comments/:id/like` | required | コメントいいね |
| DELETE | `/comments/:id/like` | required | コメントいいね取り消し |
| GET | `/comments/:id/replies` | - | 返信一覧 |
| POST | `/comments/:id/replies` | required | 返信追加（text<=80字） |
| DELETE | `/replies/:id` | required | 返信削除（本人のみ） |

### 箱（コレクション）

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/buckets` | required | 自分の箱一覧 |
| POST | `/buckets` | required | 箱作成（name<=20字） |
| DELETE | `/buckets/:id` | required | 箱削除 |
| GET | `/buckets/:id/posts` | required | 箱の中の投稿一覧 |
| POST | `/buckets/:id/posts` | required | 箱に投稿を追加 |
| DELETE | `/buckets/:id/posts/:postId` | required | 箱から投稿を外す |

## tier計算ロジック

```
likes >= 200 → gold（金皿）
likes >= 80  → silver（銀皿）
それ以外     → normal（赤皿、likes=0 含む）
```

## コード品質に関する取り組み

開発の最終フェーズで以下を順に修正した。すべて本番反映済み。

### 1. エラーハンドリングの一元化

旧実装は各 route 内で `try-catch` してその場で 500 を返していた（`errorHandler` ミドルウェアは死コードだった）。

- Express 5 の async 自動キャッチを活用して全 route の try-catch を削除
- `errorHandler` が本番モードでは詳細を隠し、開発時のみ `detail` を返す
- 削減行数: -150行、エラー応答の情報漏洩リスクを解消

### 2. tier ロジックを比率方式から likes 絶対値方式へ再設計（views 撤去）

旧実装は tier を `likes / views` の比率で算出していた。これが以下の問題を生んでいた：

- **自分で作った脆弱性を自分で塞いでいた**：`POST /posts/:id/view` が誰でも無限に叩けると tier が改竄できるため、`post_views` 中間テーブル + `UNIQUE` で「1ユーザー1ビュー」を強制する追加実装が必要だった
- **直感に反する結果**：「1いいね/1ビュー = 100% = gold」「500いいね/2000ビュー = 25% = normal」のように、絶対人気と乖離した tier が出やすかった
- **新規投稿の UX が悪い**：`views=0` ガード句のせいで、投稿直後は誰かが開くまで常に normal スタート

最初は比率方式で設計しビュー水増し攻撃を中間テーブルで防いだが、**「views を tier から外せばこの防御策ごと不要になる」と気付き**、絶対値方式へ移行した：

- `calcTier(likes)` で `>=200 gold / >=80 silver / それ未満 normal`
- `post_views` テーブル / `views` 列 / `POST /:id/view` エンドポイント / クライアントの view fetch を **すべて削除**
- 本番DBの掃除は `migrateRemoveViews()` で `DROP TABLE post_views` + `ALTER TABLE posts DROP COLUMN views` を idempotent に実行（次回 Railway デプロイで自動適用）
- 結果：コード行数 −50 / API エンドポイント −1 / 中間テーブル −1 / 守るべき脆弱性 −1。**「最初に攻撃面を増やしてから守る」より「攻撃面を持たない設計に作り直す」方が筋が良かった**という学び

### 3. N+1 クエリの解消

旧実装は、コメント一覧取得後、各コメントの返信を個別 fetch していた（コメント10件で11リクエスト）。

- 返信を `WHERE comment_id IN (?, ?, ...)` で1クエリにバッチ
- いいね済み判定も並列化（`Promise.all`）
- 結果：コメント数に依らず常に2クエリ

### 4. JWT による本人判定

旧実装は、クライアントが送ってきた `user_id` を信用していた（他人の UUID を知れば誰でもなりすまし可能）。

- 匿名 JWT を発行する `POST /auth/anonymous` を追加
- `requireAuth` / `optionalAuth` ミドルウェアで分離
- すべての書き込み route で `req.user.id` を JWT subject から取得
- 詳細は「認証フロー」セクション

### 5. zod によるバリデーション統一

旧実装は各 route に手書きの if/else バリデーションが散在していた。

- スキーマを `src/validation/schemas.ts` に集約
- `validateBody(schema)` ミドルウェアで1行適用
- 副次効果：spoiler の型違反、負の post_id、room/bucket name 長さ未指定など、旧実装では通っていた不正値を捕捉

### 6. ON DELETE CASCADE による関連削除の DB 委譲

旧実装は `DELETE /posts/:id` の中で、関連6テーブル（`comments` / `comment_likes` / `comment_replies` / `post_likes` / `post_views` / `bucket_posts`）を `db.batch` で1件ずつ手動 DELETE していた。コメント・箱削除も同様に手動 cascade（※ `post_views` はその後 §2 で撤去したため、現在は5テーブルが CASCADE 対象）。

- 全ての子テーブル FK に `ON DELETE CASCADE` を付与し、関連削除を DB エンジンに委譲
- route の delete handler は **`posts.ts` 7文→1文 / `comments.ts` 3文→1文 / `buckets.ts` 2文→1文** に集約
- 手動 cascade は「DELETE 実行中に別リクエストが孫テーブルへ INSERT する」race を許すが、CASCADE は親 DELETE と同一トランザクションで完結するため orphan が原理的に発生しない
- **マイグレーション戦略**：SQLite は `ALTER TABLE` で FK 制約を後付けできないため、SQLite 公式の「テーブル作り直し」手順（`PRAGMA foreign_keys = OFF` → `*_new` を CASCADE 付きで作成 → `INSERT INTO ... SELECT` → `DROP` → `RENAME` → `PRAGMA ON`）を `executeMultiple` で 1 HTTP リクエスト = 1 コネクションに収めた。`PRAGMA foreign_key_list` で旧スキーマを検出した時のみ実行する idempotent 設計のため、本番 Turso へは Railway 再デプロイ時のサーバー起動で1回だけ自動移行が走る（実装：[`src/db/init.ts`](src/db/init.ts) の `migrateToCascade()`）

### 7. vitest + supertest による自動テスト

route ロジックも tier 計算もテストが無く、回帰検知ができない状態だったので導入した。

- **構成**：[`vitest`](https://vitest.dev) を test runner、`supertest` で実 Express アプリ（`src/app.ts` の `createApp()`）を HTTP レベルで叩く。Express の組み立てを `createApp` ファクトリに切り出したことで、本番起動 (`src/index.ts`) と完全に同じ app をテストから流用できる
- **DB 分離**：`vitest.config.ts` で `TURSO_URL=file::memory:?cache=shared` を注入し、本番 Turso には一切触らない in-memory SQLite で完結。`beforeEach` で `posts` と `buckets` を全削除すれば CASCADE で関連も消えるため、各テストは独立状態から開始できる
- **カバー範囲**（[`src/__tests__/`](src/__tests__)）：
  - `tier.test.ts` — `calcTier(likes)` の境界値（80 / 200 ちょうど、各帯、likes=0 新規投稿は normal）を網羅
  - `api.test.ts` — `/auth/anonymous` / posts / comments / buckets の主要ハッピーパス + 認証/権限の負パス（401, 403）+ zod の負パス（400）+ UNIQUE 制約の負パス（409）+ **CASCADE が DB レベルで効いていることを直接 COUNT(*) で確認するテスト3本**
- 全 22 テストが約 1.5 秒で完了。`npm test` で実行、`npm run test:watch` でファイル監視

### 8. pino + pino-http による構造化ロギング

旧実装は `console.log` / `console.error` を直書きしていたため、本番（Railway）のログ検索が文字列 grep でしか出来ず、リクエスト単位のトレースも追えなかった。

- **モード切替**（[`src/logger.ts`](src/logger.ts)）：
  - production → 1行JSON出力（Railway のログ検索や Datadog 等の収集系と相性が良い）
  - development → `pino-pretty` でカラー整形（ローカル可読性のためだけ）
  - test → `silent`（vitest の出力をログノイズで埋めない）
- **リクエスト文脈の自動付与**：`pino-http` を `createApp()` で1行 `app.use()` するだけで、全リクエストに自動で `reqId / method / url / 応答ms / status` がログ付与される。さらに各 handler は `req.log.info(...)` で「このリクエストのログ」として書ける（同時並行リクエストが混線しない）
- **エラーハンドラの統合**：`errorHandler` は `req.log.error({ err }, "...")` で、リクエストIDが付いた構造化ログを残す。本番では JSON のフィールドとして `err.stack` が記録されるため、Sentry 等への移行コストも低い
- **ログレベルは `LOG_LEVEL` 環境変数で上書き可能**：例えば本番で `LOG_LEVEL=warn` にすれば成功リクエスト（info）が抑制され、ログ容量を圧縮できる

### 9. express-rate-limit によるレート制限（2層構成）

匿名 JWT 発行は認証不要なので、無制限に許すと自動化スクリプトで匿名 `user_id` を量産され、偽いいねの大量投票に使われる脆弱性があった。投稿系も無制限だとスパム投稿で皿（コンベア）を埋め尽くされる懸念があった。

- **2つの limiter を用途別に分離**（[`src/middleware/rateLimit.ts`](src/middleware/rateLimit.ts)）：
  - `authLimiter` — `/auth/anonymous` 専用、**IPベース 10 req / 1 時間**。JWT 量産 DoS と偽 user_id 生成攻撃を抑止
  - `writeLimiter` — 全書き込み系 (POST 投稿・コメント・返信・箱・いいね) に適用、**ユーザーIDベース 60 req / 1 分**。NAT 経由で同一 IP を共有する複数ユーザーが誤って巻き込まれない設計
- **`X-Forwarded-For` 詐称対策**：Railway 等のリバースプロキシ越しに `req.ip` を正しく取るため `app.set("trust proxy", 1)` で「1 hop だけ信用」。`true` だとヘッダ詐称で IP ベース制限が無力化されるため、本番想定の最小権限値を選んだ
- **`RateLimit-*` ヘッダ (RFC 9239 draft-7) を返す**：賢いクライアントは応答ヘッダから残量を察知して自前で間引ける
- **IPv6 対応**：`ipKeyGenerator()` ヘルパー経由でキー生成し、IPv6 のサブネット集約を効かせる
- **429 レスポンスは JSON で統一**：`errorHandler` が返す形 (`{ error: "..." }`) と揃え、クライアントが横断的に処理できる
- **テスト時 (`NODE_ENV=test`) は `skip` で完全バイパス**：22 テストが limit に当たって落ちるのを防止

### 10. クエリ頻度の高い列への B-tree インデックス追加

旧実装は UNIQUE 制約用の composite index しか張っていなかったため、リスト系（フィード / コメント一覧 / 自分の箱）が全テーブルスキャンになる懸念があった。皿が数千件規模に増えたとき、フィード API の応答が線形に遅くなる。

- 既存の `uq_*` UNIQUE 制約は単一行 lookup と重複防止に最適だが、composite の **leading column 規則** により単独カラム WHERE には使えない (例: `uq_post_likes (post_id, user_id)` は `WHERE user_id = ?` に効かない)
- 以下5本の追加 B-tree index で、route のリスト系クエリを index seek に変えた：

| index | 対応するクエリ | 効く理由 |
|---|---|---|
| `idx_posts_created_at` | `GET /posts` の `ORDER BY created_at DESC` | SQLite は ASC index でも backward scan できるので DESC 指定は不要 |
| `idx_comments_post (post_id, created_at)` | `GET /posts/:id/comments` の `WHERE post_id=? ORDER BY created_at` | composite で WHERE と ORDER BY を同時に賄える |
| `idx_replies_comment (comment_id, created_at)` | N+1 解消した `WHERE comment_id IN (...) ORDER BY ...` | IN リストでも leading column が効く |
| `idx_buckets_user (user_id, created_at)` | `GET /buckets` の `WHERE user_id=? ORDER BY created_at` | 自分の箱一覧 |
| `idx_post_likes_user (user_id)` | `GET /posts/liked` の `WHERE user_id=?` | 既存 `uq_post_likes` は post_id 起点なので別途必要 |

`initDb()` 内で `CREATE INDEX IF NOT EXISTS` で宣言するため、Railway 再デプロイ時に自動で追加される。既存データには影響しない（idempotent）。

**動作検証**：in-memory SQLite に 200 行投入 → `ANALYZE` → `EXPLAIN QUERY PLAN` で全5本が optimizer に採用されていることを確認した：

```
[GET /posts feed]            SCAN posts USING INDEX idx_posts_created_at
[GET /posts/liked]           SEARCH post_likes USING INDEX idx_post_likes_user (user_id=?)
[GET /posts/:id/comments]    SEARCH comments USING INDEX idx_comments_post (post_id=?)
[GET /buckets]               SEARCH buckets USING INDEX idx_buckets_user (user_id=?)
[replies bulk fetch]         SEARCH comment_replies USING INDEX idx_replies_comment (comment_id=?)
```

### 11. 軽量セキュリティハードニング

- `app.disable("x-powered-by")` で Express デフォルトの `X-Powered-By: Express` レスポンスヘッダを削除。フレームワーク名を晒すと攻撃者に既知の Express CVE を狙い撃ちされる手掛かりを与えるため、1行で塞いだ
- 回帰防止のため supertest で `expect(res.headers["x-powered-by"]).toBeUndefined()` を1本追加
- `helmet` パッケージ (HSTS / X-Frame-Options / X-Content-Type-Options など 15 種の defensive ヘッダを一括設定) はまだ入れていない。本プロジェクトは API 専用で HTML を返さないため CSP 等は不要、CORS と JWT で最低限のサーフェスは塞いでいる。本格運用なら入れる候補として改善案に残す

## 改善案・既知の課題

時間が許せば次に取り組みたい項目。

- **メール+パスワード認証**：現状は匿名のみ。アカウント連携の余地を残している
- **Redis ベースのレート制限ストア**：現状は `MemoryStore` (プロセス内) なので、Railway のインスタンスが複数になった瞬間に limit が分散カウントされる。スケールするなら `rate-limit-redis` への置換が必要
- **helmet による包括的なセキュリティヘッダ設定**：HTTPS 越し配信時の HSTS など、API 専用 でも入れて損は無い

## 環境変数

| 変数名 | 説明 |
|---|---|
| `TURSO_URL` | TursoデータベースのURL（`libsql://...`） |
| `TURSO_TOKEN` | Turso認証トークン |
| `JWT_SECRET` | JWT署名用シークレット（32バイト以上推奨）。`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` で生成 |
| `PORT` | ポート番号（省略時 3000） |
| `NODE_ENV` | `production` でエラー詳細を隠蔽 + ログを1行JSONに切替 |
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` / `silent`（省略時は `info`、テスト時 `silent`） |

## ローカル起動

```bash
cp .env.example .env
# .env の値を埋める
npm install
npm run dev
```

## テスト

```bash
npm test          # 1回だけ実行（22 tests, 約 1.5s）
npm run test:watch  # ファイル監視モード
```

本番 Turso には触らず `file::memory:?cache=shared` の in-memory SQLite で完結するので、`.env` 未設定でも実行できる。詳細は「コード品質に関する取り組み §7」を参照。

## プロジェクト構成

```
src/
├── types/
│   └── index.ts              # Post, Comment, Reply, Bucket の型定義
├── db/
│   └── init.ts               # libsql クライアント・スキーマ初期化・CASCADE移行・tier計算
├── middleware/
│   ├── auth.ts               # JWT 発行・検証、requireAuth/optionalAuth
│   ├── validate.ts           # zod スキーマでリクエスト検証
│   ├── rateLimit.ts          # authLimiter (IP) / writeLimiter (user_id) の2層
│   └── errorHandler.ts       # グローバルエラーハンドラ（本番モード対応）
├── validation/
│   └── schemas.ts            # 全 route 用の zod スキーマ集約
├── routes/
│   ├── auth.ts               # POST /auth/anonymous
│   ├── posts.ts              # /posts 関連
│   ├── comments.ts           # /comments・/replies 関連
│   └── buckets.ts            # /buckets 関連
├── __tests__/
│   ├── tier.test.ts          # calcTier のユニットテスト
│   └── api.test.ts           # supertest による route 統合テスト + CASCADE 検証
├── logger.ts                 # pino ロガー（本番JSON / 開発pretty / テスト silent）
├── app.ts                    # Express app の組み立て（createApp ファクトリ + pinoHttp）
└── index.ts                  # サーバ起動エントリポイント
```
