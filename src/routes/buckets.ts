import { Router } from "express";
import { db, calcTier } from "../db/init";
import type { Bucket, Post } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query as { user_id: string };
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const { rows } = await db.execute({ sql: "SELECT * FROM buckets WHERE user_id = ? ORDER BY created_at DESC", args: [user_id] });
    res.json(rows);
  } catch (e) {
    console.error("GET /buckets error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, user_id } = req.body as { name: string; user_id: string };
    if (!name || name.trim() === "") { res.status(400).json({ error: "name is required" }); return; }
    if (!user_id) { res.status(400).json({ error: "user_id is required" }); return; }

    const result = await db.execute({ sql: "INSERT INTO buckets (name, user_id) VALUES (?, ?)", args: [name.trim(), user_id] });
    const { rows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [Number(result.lastInsertRowid)] });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /buckets error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.get("/:id/posts", async (req, res) => {
  try {
    const bucketId = Number(req.params.id);
    const { user_id } = req.query as { user_id: string };

    const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
    const bucket = bucketRows[0] as unknown as Bucket | undefined;
    if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
    if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    const { rows } = await db.execute({ sql: "SELECT p.* FROM posts p INNER JOIN bucket_posts bp ON bp.post_id = p.id WHERE bp.bucket_id = ? ORDER BY bp.id DESC", args: [bucketId] });
    const posts = rows as unknown as Post[];
    res.json(posts.map((p) => ({ ...p, likes: Number(p.likes), views: Number(p.views), spoiler: Number(p.spoiler ?? 0), tier: calcTier(Number(p.likes), Number(p.views)) })));
  } catch (e) {
    console.error("GET /buckets/:id/posts error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.post("/:id/posts", async (req, res) => {
  try {
    const bucketId = Number(req.params.id);
    const { post_id, user_id } = req.body as { post_id: number; user_id: string };

    const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
    const bucket = bucketRows[0] as unknown as Bucket | undefined;
    if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
    if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    const { rows: existing } = await db.execute({ sql: "SELECT 1 FROM bucket_posts WHERE bucket_id = ? AND post_id = ?", args: [bucketId, post_id] });
    if (existing[0]) { res.status(400).json({ error: "Already in bucket" }); return; }

    await db.execute({ sql: "INSERT INTO bucket_posts (bucket_id, post_id) VALUES (?, ?)", args: [bucketId, post_id] });
    res.status(201).json({ message: "added" });
  } catch (e) {
    console.error("POST /buckets/:id/posts error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/:id/posts/:postId", async (req, res) => {
  try {
    const bucketId = Number(req.params.id);
    const postId   = Number(req.params.postId);
    const { user_id } = req.body as { user_id: string };

    const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
    const bucket = bucketRows[0] as unknown as Bucket | undefined;
    if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
    if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    await db.execute({ sql: "DELETE FROM bucket_posts WHERE bucket_id = ? AND post_id = ?", args: [bucketId, postId] });
    res.json({ message: "removed" });
  } catch (e) {
    console.error("DELETE /buckets/:id/posts/:postId error:", e);
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const bucketId = Number(req.params.id);
    const { user_id } = req.body as { user_id: string };

    const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
    const bucket = bucketRows[0] as unknown as Bucket | undefined;
    if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
    if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

    await db.batch([
      { sql: "DELETE FROM bucket_posts WHERE bucket_id = ?", args: [bucketId] },
      { sql: "DELETE FROM buckets WHERE id = ?", args: [bucketId] },
    ], "write");
    res.json({ message: "deleted" });
  } catch (e) {
    console.error("DELETE /buckets/:id error:", e);
    res.status(500).json({ error: String(e) });
  }
});

export default router;
