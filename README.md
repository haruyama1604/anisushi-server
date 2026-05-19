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

## 設計上の判断

### 1. 匿名 JWT 認証を採用

メール+パスワードや OAuth ではなく、**初回起動時に匿名ユーザーIDを払い出して JWT で永続化**する方式を選んだ。

- アプリのコンセプトが「気軽に流れる皿を取る」匿名コミュニティで、サインアップフローはUXを損なう
- それでも「クライアントが他人の user_id を詐称できる」という旧実装の脆弱性は塞ぐ必要があった
- サーバが署名検証した JWT の `sub` クレームのみを `user_id` とすることで、なりすましを不可能にした

### 2. tier ロジックは集計値ベース

各投稿の `tier`（金皿/銀皿/赤皿）はリクエスト時に `likes / views` で都度算出する。

- DB に保存しない理由：likes も views も変動するため、保存した瞬間に古くなる
- views を1ユーザー1回に制限することで、tier 操作の悪用を防ぐ（後述）

### 3. N+1 を許容しない

コメント取得時、各コメントの返信を個別 fetch すると N+1 になる。
これは `WHERE comment_id IN (?, ?, ...)` のバッチクエリ + `Promise.all` での並列化で **コメント数に依らず2クエリ**に抑えている。

## データモデル

```
posts            ──┬── post_likes  (user_id, post_id) UNIQUE
                   ├── post_views  (user_id, post_id) UNIQUE  ※tier操作防止
                   ├── comments  ──┬── comment_likes (UNIQUE)
                   │               └── comment_replies
                   └── bucket_posts (UNIQUE)
buckets          ──┘
```

すべてのテーブルに `created_at TEXT NOT NULL DEFAULT (datetime('now'))` を持たせている。
論理削除はせず、関連レコードはアプリ層でバッチ削除（将来 `ON DELETE CASCADE` への置換を検討中）。

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
| POST | `/posts/:id/view` | required | ビュー記録（1ユーザー1回） |

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
likes / views >= 0.7 → gold（金皿）
likes / views >= 0.4 → silver（銀皿）
それ以外           → normal（赤皿）
views = 0          → normal
```

## コード品質に関する取り組み

開発の最終フェーズで以下を順に修正した。すべて本番反映済み。

### 1. エラーハンドリングの一元化

旧実装は各 route 内で `try-catch` してその場で 500 を返していた（`errorHandler` ミドルウェアは死コードだった）。

- Express 5 の async 自動キャッチを活用して全 route の try-catch を削除
- `errorHandler` が本番モードでは詳細を隠し、開発時のみ `detail` を返す
- 削減行数: -150行、エラー応答の情報漏洩リスクを解消

### 2. ビューカウント水増し脆弱性の修正

旧実装は `POST /posts/:id/view` を誰でも無限に叩けた。
likes/views 比で決まる tier を、悪意あるクライアントが操作できる状態だった。

- `post_views` 中間テーブル + `UNIQUE (post_id, user_id)` で「1ユーザー1ビュー」を強制
- レスポンスに `counted` フラグを返し、クライアントが初回ビューか判定可能に

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

## 改善案・既知の課題

時間が許せば次に取り組みたい項目。

- **テストコード**：vitest + supertest で各 route の主要ケースをカバーしたい
- **構造化ロガー**：pino を導入、`console.error` を置き換える
- **レート制限**：express-rate-limit。投稿スパム対策
- **ON DELETE CASCADE**：現在アプリ層で手動 cascade している部分を SQL の宣言に置き換え、race condition 耐性を上げる
- **DB index**：`posts(created_at)`、`comments(post_id)` などクエリ頻度の高い列に追加
- **メール+パスワード認証**：現状は匿名のみ。アカウント連携の余地を残している

## 環境変数

| 変数名 | 説明 |
|---|---|
| `TURSO_URL` | TursoデータベースのURL（`libsql://...`） |
| `TURSO_TOKEN` | Turso認証トークン |
| `JWT_SECRET` | JWT署名用シークレット（32バイト以上推奨）。`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` で生成 |
| `PORT` | ポート番号（省略時 3000） |
| `NODE_ENV` | `production` でエラー詳細を隠蔽 |

## ローカル起動

```bash
cp .env.example .env
# .env の値を埋める
npm install
npm run dev
```

## プロジェクト構成

```
src/
├── types/
│   └── index.ts              # Post, Comment, Reply, Bucket の型定義
├── db/
│   └── init.ts               # libsql クライアント・スキーマ初期化・tier計算
├── middleware/
│   ├── auth.ts               # JWT 発行・検証、requireAuth/optionalAuth
│   ├── validate.ts           # zod スキーマでリクエスト検証
│   └── errorHandler.ts       # グローバルエラーハンドラ（本番モード対応）
├── validation/
│   └── schemas.ts            # 全 route 用の zod スキーマ集約
├── routes/
│   ├── auth.ts               # POST /auth/anonymous
│   ├── posts.ts              # /posts 関連
│   ├── comments.ts           # /comments・/replies 関連
│   └── buckets.ts            # /buckets 関連
└── index.ts                  # サーバ起動・ルート登録
```
