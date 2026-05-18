import { Router } from "express";
import { db, calcTier } from "../db/init";
import type { Post } from "../types";

const router = Router();

router.get("/liked", async (req, res) => {
  try {
    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }
    const { rows } = await db.execute({ sql: "SELECT post_id FROM post_likes WHERE user_id = ?", args: [user_id] });
    res.json(rows.map((r) => Number(r.post_id)));
  } catch (e) {
    console.error("GET /posts/liked error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.get("/", async (_req, res) => {
  try {
    const { rows } = await db.execute("SELECT * FROM posts ORDER BY created_at DESC");
    const posts = rows as unknown as Post[];
    res.json(posts.map((p) => ({
      id: p.id, content: p.content, likes: Number(p.likes), views: Number(p.views),
      user_id: p.user_id, room: p.room, created_at: p.created_at,
      spoiler: Number(p.spoiler ?? 0), tier: calcTier(Number(p.likes), Number(p.views)),
    })));
  } catch (e) {
    console.error("GET /posts error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/", async (req, res) => {
  try {
    const { content, user_id, room, spoiler } = req.body as { content: string; user_id: string; room: string; spoiler?: boolean };
    if (!content || content.trim() === "") { res.status(400).json({ error: "content is required" }); return; }
    if (content.trim().length > 80) { res.status(400).json({ error: "content must be 80 characters or fewer" }); return; }
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const result = await db.execute({ sql: "INSERT INTO posts (content, user_id, room, spoiler) VALUES (?, ?, ?, ?)", args: [content.trim(), user_id, room ?? "", spoiler ? 1 : 0] });
    const { rows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [Number(result.lastInsertRowid)] });
    const post = rows[0] as unknown as Post;
    res.status(201).json({ ...post, likes: Number(post.likes), views: Number(post.views), spoiler: Number(post.spoiler), tier: calcTier(Number(post.likes), Number(post.views)) });
  } catch (e) {
    console.error("POST /posts error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }

    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const { rows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
    const post = rows[0] as unknown as Post | undefined;
    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    if (post.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    await db.batch([
      { sql: "DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)", args: [id] },
      { sql: "DELETE FROM comment_replies WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)", args: [id] },
      { sql: "DELETE FROM comments WHERE post_id = ?", args: [id] },
      { sql: "DELETE FROM post_likes WHERE post_id = ?", args: [id] },
      { sql: "DELETE FROM bucket_posts WHERE post_id = ?", args: [id] },
      { sql: "DELETE FROM posts WHERE id = ?", args: [id] },
    ], "write");

    res.json({ message: "deleted" });
  } catch (e) {
    console.error("DELETE /posts/:id error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/:id/view", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }
    await db.execute({ sql: "UPDATE posts SET views = views + 1 WHERE id = ?", args: [id] });
    const { rows } = await db.execute({ sql: "SELECT views FROM posts WHERE id = ?", args: [id] });
    if (!rows[0]) { res.status(404).json({ error: "Post not found" }); return; }
    res.json({ views: Number(rows[0].views) });
  } catch (e) {
    console.error("POST /posts/:id/view error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/:id/like", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }

    const { user_id } = req.body as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const { rows: postRows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
    if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }

    const { rows: likeRows } = await db.execute({ sql: "SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?", args: [id, user_id] });
    if (likeRows[0]) { res.status(409).json({ error: "Already liked" }); return; }

    await db.batch([
      { sql: "INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)", args: [id, user_id] },
      { sql: "UPDATE posts SET likes = likes + 1 WHERE id = ?", args: [id] },
    ], "write");

    const { rows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
    const updated = rows[0] as unknown as Post;
    res.json({ id: updated.id, likes: Number(updated.likes), tier: calcTier(Number(updated.likes), Number(updated.views)) });
  } catch (e) {
    console.error("POST /posts/:id/like error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/:id/like", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid post id" }); return; }

    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const { rows: postRows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
    if (!postRows[0]) { res.status(404).json({ error: "Post not found" }); return; }

    const { rows: likeRows } = await db.execute({ sql: "SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?", args: [id, user_id] });
    if (!likeRows[0]) { res.status(400).json({ error: "Not liked yet" }); return; }

    await db.batch([
      { sql: "DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", args: [id, user_id] },
      { sql: "UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?", args: [id] },
    ], "write");

    const { rows } = await db.execute({ sql: "SELECT * FROM posts WHERE id = ?", args: [id] });
    const updated = rows[0] as unknown as Post;
    res.json({ id: updated.id, likes: Number(updated.likes), tier: calcTier(Number(updated.likes), Number(updated.views)) });
  } catch (e) {
    console.error("DELETE /posts/:id/like error:", e);
    res.status(500).json({ error: String(e) });
  }
});

export default router;
