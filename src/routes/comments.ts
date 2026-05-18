import { Router } from "express";
import { db } from "../db/init";
import type { Comment, Reply } from "../types";

const router = Router({ mergeParams: true });

router.get("/posts/:id/comments", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
    const { user_id } = req.query as { user_id?: string };

    const { rows: postRows } = await db.execute({ sql: "SELECT 1 FROM posts WHERE id = ?", args: [id] });
    if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }

    const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC", args: [id] });
    const comments = rows as unknown as Comment[];

    let likedSet = new Set<number>();
    if (user_id && comments.length > 0) {
      const ids = comments.map((c) => Number(c.id));
      const placeholders = ids.map(() => "?").join(", ");
      const { rows: likedRows } = await db.execute({
        sql: `SELECT comment_id FROM comment_likes WHERE comment_id IN (${placeholders}) AND user_id = ?`,
        args: [...ids, user_id],
      });
      likedSet = new Set(likedRows.map((r) => Number(r.comment_id)));
    }

    res.json(comments.map((c) => ({
      id: c.id, text: c.text, user_id: c.user_id, likes: Number(c.likes),
      created_at: c.created_at, liked_by_user: likedSet.has(Number(c.id)),
    })));
  } catch (e) {
    console.error("GET /posts/:id/comments error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/posts/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (isNaN(postId)) { res.status(400).json({ error: "Invalid post id" }); return; }
    const { text, user_id } = req.body as { text: string; user_id: string };

    const { rows: postRows } = await db.execute({ sql: "SELECT 1 FROM posts WHERE id = ?", args: [postId] });
    if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }
    if (!text || text.trim() === "") { res.status(400).json({ error: "text is required" }); return; }
    if (text.trim().length > 80) { res.status(400).json({ error: "text must be 80 characters or fewer" }); return; }

    const result = await db.execute({ sql: "INSERT INTO comments (post_id, text, user_id) VALUES (?, ?, ?)", args: [postId, text.trim(), user_id ?? "anonymous"] });
    const { rows } = await db.execute({ sql: "SELECT * FROM comments WHERE id = ?", args: [Number(result.lastInsertRowid)] });
    const comment = rows[0] as unknown as Comment;
    res.status(201).json({ ...comment, likes: Number(comment.likes) });
  } catch (e) {
    console.error("POST /posts/:id/comments error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/comments/:id/like", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { user_id } = req.body as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

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
  } catch (e) {
    console.error("POST /comments/:id/like error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/comments/:id/like", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

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
  } catch (e) {
    console.error("DELETE /comments/:id/like error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.get("/comments/:id/replies", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { rows: commentRows } = await db.execute({ sql: "SELECT 1 FROM comments WHERE id = ?", args: [id] });
    if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }

    const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at ASC", args: [id] });
    res.json(rows);
  } catch (e) {
    console.error("GET /comments/:id/replies error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/comments/:id/replies", async (req, res) => {
  try {
    const commentId = Number(req.params.id);
    if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { text, user_id } = req.body as { text: string; user_id: string };

    const { rows: commentRows } = await db.execute({ sql: "SELECT 1 FROM comments WHERE id = ?", args: [commentId] });
    if (!commentRows[0]) { res.status(404).json({ error: "Comment not found" }); return; }
    if (!text || text.trim() === "") { res.status(400).json({ error: "text is required" }); return; }
    if (text.trim().length > 80) { res.status(400).json({ error: "text must be 80 characters or fewer" }); return; }

    const result = await db.execute({ sql: "INSERT INTO comment_replies (comment_id, text, user_id) VALUES (?, ?, ?)", args: [commentId, text.trim(), user_id ?? "anonymous"] });
    const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE id = ?", args: [Number(result.lastInsertRowid)] });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /comments/:id/replies error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/comments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

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
  } catch (e) {
    console.error("DELETE /comments/:id error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/replies/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid reply id" }); return; }
    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const { rows } = await db.execute({ sql: "SELECT * FROM comment_replies WHERE id = ?", args: [id] });
    const reply = rows[0] as unknown as Reply | undefined;
    if (!reply) { res.status(404).json({ error: "Reply not found" }); return; }
    if (reply.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    await db.execute({ sql: "DELETE FROM comment_replies WHERE id = ?", args: [id] });
    res.json({ message: "deleted" });
  } catch (e) {
    console.error("DELETE /replies/:id error:", e);
    res.status(500).json({ error: String(e) });
  }
});

export default router;
