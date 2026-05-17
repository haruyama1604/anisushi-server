# anisushi-server

アニメ特化の回転寿司SNS「あにすし」のバックエンドAPI。

## 本番URL

https://anisushi-server-production.up.railway.app/posts

## 技術スタック

| 技術 | 用途 |
|---|---|
| TypeScript / Node.js | 言語・ランタイム |
| Express | Webフレームワーク |
| Turso（libsql） | クラウドSQLiteデータベース |
| Railway | デプロイ・ホスティング |

## APIエンドポイント一覧

### 投稿

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/posts` | 投稿一覧（tier付き） |
| POST | `/posts` | 投稿作成 |
| DELETE | `/posts/:id` | 投稿削除（本人のみ） |
| GET | `/posts/liked` | いいね済み投稿ID一覧 |
| POST | `/posts/:id/like` | いいね |
| DELETE | `/posts/:id/like` | いいね取り消し |

### コメント・返信

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/posts/:id/comments` | コメント一覧 |
| POST | `/posts/:id/comments` | コメント追加 |
| DELETE | `/comments/:id` | コメント削除（本人のみ） |
| POST | `/comments/:id/like` | コメントにいいね |
| DELETE | `/comments/:id/like` | コメントいいね取り消し |
| GET | `/comments/:id/replies` | 返信一覧 |
| POST | `/comments/:id/replies` | 返信追加 |
| DELETE | `/replies/:id` | 返信削除（本人のみ） |

### 箱（コレクション）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/buckets` | 箱一覧 |
| POST | `/buckets` | 箱作成 |
| DELETE | `/buckets/:id` | 箱削除 |
| GET | `/buckets/:id/posts` | 箱の中の投稿一覧 |
| POST | `/buckets/:id/posts` | 箱に投稿を追加 |
| DELETE | `/buckets/:id/posts/:postId` | 箱から投稿を外す |

## tier計算ロジック

```
likes / views >= 0.7 → gold（金皿）
likes / views >= 0.4 → silver（銀皿）
それ以外           → normal（赤皿）
views = 0          → normal
```

## 環境変数

| 変数名 | 説明 |
|---|---|
| `TURSO_URL` | TursoデータベースのURL（`libsql://...`） |
| `TURSO_TOKEN` | Turso認証トークン |
| `PORT` | ポート番号（省略時 3000） |

## ローカル起動

```bash
npm install
npx ts-node src/index.ts
```

## プロジェクト構成

```
src/
├── types/
│   └── index.ts          # 型定義
├── db/
│   └── init.ts           # DB接続・スキーマ初期化
├── routes/
│   ├── posts.ts          # /posts 関連
│   ├── comments.ts       # /comments・/replies 関連
│   └── buckets.ts        # /buckets 関連
├── middleware/
│   └── errorHandler.ts   # グローバルエラーハンドラー
└── index.ts              # サーバー起動・ルート登録
```
