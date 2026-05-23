import { Router } from "express";
import { db } from "../db/init";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { CreateCommentBody, CreateReplyBody } from "../validation/schemas";
import type { Comment, Reply } from "../types";

const router = Router({ mergeParams: true });

router.get("/posts/:id/comments", optionalAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
  const user_id = req.user?.id;

  const { rows: postRows } = await db.execute({ sql: "SELECT 1 FROM posts WHERE id = ?", args: [id] });
  if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }

  const { rows: commentRows } = await db.execute({
    sql: "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC",
    args: [id],
  });
  const comments = commentRows as unknown as Comment[];

  if (comments.length === 0) {
    res.json([]);
    return;
  }

  const commentIds = comments.map((c) => Number(c.id));
  const placeholders = commentIds.map(() => "?").join(", ");

  // 返信といいね済み判定を並列取得（N+1 を解消）
  const [repliesResult, likedResult] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM comment_replies WHERE comment_id IN (${placeholders}) ORDER BY created_at ASC`,
      args: commentIds,
    }),
    user_id
      ? db.execute({
          sql: `SELECT comment_id FROM comment_likes WHERE comment_id IN (${placeholders}) AND user_id = ?`,
          args: [...commentIds, user_id],
        })
      : Promise.resolve({ rows: [] as { comment_id: number }[] }),
  ]);

  // 返信を comment_id でグルーピング
  const repliesByComment = new Map<number, Reply[]>();
  for (const r of repliesResult.rows as unknown as Reply[]) {
    const cid = Number(r.comment_id);
    const list = repliesByComment.get(cid) ?? [];
    list.push(r);
    repliesByComment.set(cid, list);
  }

  const likedSet = new Set(likedResult.rows.map((r) => Number(r.comment_id)));

  res.json(comments.map((c) => ({
    id: c.id,
    text: c.text,
    user_id: c.user_id,
    likes: Number(c.likes),
    created_at: c.created_at,
    liked_by_user: likedSet.has(Number(c.id)),
    replies: repliesByComment.get(Number(c.id)) ?? [],
  })));
});

router.post("/posts/:id/comments", requireAuth, validateBody(CreateCommentBody), async (req, res) => {
  const user_id = req.user!.id;
  const postId = Number(req.params.id);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid post id" }); return; }
  const { text } = req.body;

  const { rows: postRows } = await db.execute({ sql: "SELECT 1 FROM posts WHERE id = ?", args: [postId] });
  if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }

  const result = await db.execute({ sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [postId, text, user_id] });
  const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [Number(result.lastInsertRowid)] });
  const comment = rows[0] as unknown as Comment;
  res.status(201).json({ ...comment, likes: Number(comment.likes) });
});

router.post("/comments/:id/like", requireAuth, async (req, res) => {
  const user_id = req.user!.id;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }

  const { rows: commentRows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [id] });
  if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }

  const { rows: likeRows } = await db.execute({ sql: "SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?", args: [id, user_id] });
  if (likeRows[0]) { res.status(409).json({ error: "Already liked" }); return; }

  await db.batch([
    { sql: "INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)", args: [id, user_id] },
    { sql: "UPDATE comments SET likes = likes + 1 WHERE id = ?", args: [id] },
  ], "write");

  const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [id] });
  const updated = rows[0] as unknown as Comment;
  res.json({ id: updated.id, likes: Number(updated.likes) });
});

router.delete("/comments/:id/like", requireAuth, async (req, res) => {
  const user_id = req.user!.id;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }

  const { rows: commentRows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [id] });
  if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }

  const { rows: likeRows } = await db.execute({ sql: "SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?", args: [id, user_id] });
  if (!likeRows[0]) { res.status(400).json({ error: "Not liked yet" }); return; }

  await db.batch([
    { sql: "DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?", args: [id, user_id] },
    { sql: "UPDATE comments SET likes = MAX(0, likes - 1) WHERE id = ?", args: [id] },
  ], "write");

  const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [id] });
  const updated = rows[0] as unknown as Comment;
  res.json({ id: updated.id, likes: Number(updated.likes) });
});

router.get("/comments/:id/replies", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
  const { rows: commentRows } = await db.execute({ sql: "SELECT 1 FROM comments WHERE id = ?", args: [id] });
  if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }

  const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at ASC", args: [id] });
  res.json(rows);
});

router.post("/comments/:id/replies", requireAuth, validateBody(CreateReplyBody), async (req, res) => {
  const user_id = req.user!.id;
  const commentId = Number(req.params.id);
  if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment id" }); return; }
  const { text } = req.body;

  const { rows: commentRows } = await db.execute({ sql: "SELECT post_id FROM comments WHERE id = ?", args: [commentId] });
  if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }
  const postId = Number(commentRows[0].post_id);

  // 返信は、その投稿（皿）をいいね（取って）いるユーザーのみ可。
  // フロントの UI ガードと同じ条件を、API 直叩きを想定してサーバー側でも強制する。
  const { rows: likeRows } = await db.execute({
    sql: "SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?",
    args: [postId, user_id],
  });
  if (!likeRows[0]) { res.status(403).json({ error: "Like the post first to reply" }); return; }

  const result = await db.execute({ sql: "INSERT INTO comment_replies (comment_id, text, user_id) VALUES (?, ?, ?)", args: [commentId, text, user_id] });
  const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE id = ?", args: [Number(result.lastInsertRowid)] });
  res.status(201).json(rows[0]);
});

router.delete("/comments/:id", requireAuth, async (req, res) => {
  const user_id = req.user!.id;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }

  const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [id] });
  const comment = rows[0] as unknown as Comment | undefined;
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
  if (comment.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  await db.batch([
    { sql: "DELETE FROM comment_likes WHERE comment_id = ?", args: [id] },
    { sql: "DELETE FROM comment_replies WHERE comment_id = ?", args: [id] },
    { sql: "DELETE FROM comments WHERE id = ?", args: [id] },
  ], "write");
  res.json({ message: "deleted" });
});

router.delete("/replies/:id", requireAuth, async (req, res) => {
  const user_id = req.user!.id;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid reply id" }); return; }

  const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE id = ?", args: [id] });
  const reply = rows[0] as unknown as Reply | undefined;
  if (!reply) { res.status(404).json({ error: "Reply not found" }); return; }
  if (reply.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  await db.execute({ sql: "DELETE FROM comment_replies WHERE id = ?", args: [id] });
  res.json({ message: "deleted" });
});

export default router;
