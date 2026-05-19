import { Router } from "express";
import { db, calcTier } from "../db/init";
import { requireAuth } from "../middleware/auth";
import type { Bucket, Post } from "../types";

const router = Router();

// 箱機能はすべてユーザー固有のため、全エンドポイントで認証必須
router.use(requireAuth);

router.get("/", async (req, res) => {
  const user_id = req.user!.id;
  const { rows } = await db.execute({ sql: "SELECT * FROM buckets WHERE user_id = ? ORDER BY created_at DESC", args: [user_id] });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const user_id = req.user!.id;
  const { name } = req.body as { name: string };
  if (!name || name.trim() === "") { res.status(400).json({ error: "name is required" }); return; }

  const result = await db.execute({ sql: "INSERT INTO buckets (name, user_id) VALUES (?, ?)", args: [name.trim(), user_id] });
  const { rows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [Number(result.lastInsertRowid)] });
  res.status(201).json(rows[0]);
});

router.get("/:id/posts", async (req, res) => {
  const user_id = req.user!.id;
  const bucketId = Number(req.params.id);
  if (isNaN(bucketId)) { res.status(400).json({ error: "Invalid bucket id" }); return; }

  const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
  const bucket = bucketRows[0] as unknown as Bucket | undefined;
  if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
  if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  const { rows } = await db.execute({ sql: "SELECT p.* FROM posts p INNER JOIN bucket_posts bp ON bp.post_id = p.id WHERE bp.bucket_id = ? ORDER BY bp.id DESC", args: [bucketId] });
  const posts = rows as unknown as Post[];
  res.json(posts.map((p) => ({ ...p, likes: Number(p.likes), views: Number(p.views), spoiler: Number(p.spoiler ?? 0), tier: calcTier(Number(p.likes), Number(p.views)) })));
});

router.post("/:id/posts", async (req, res) => {
  const user_id = req.user!.id;
  const bucketId = Number(req.params.id);
  if (isNaN(bucketId)) { res.status(400).json({ error: "Invalid bucket id" }); return; }

  const { post_id } = req.body as { post_id: number };
  if (!post_id || isNaN(Number(post_id))) { res.status(400).json({ error: "post_id is required" }); return; }

  const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
  const bucket = bucketRows[0] as unknown as Bucket | undefined;
  if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
  if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  const { rows: existing } = await db.execute({ sql: "SELECT 1 FROM bucket_posts WHERE bucket_id = ? AND post_id = ?", args: [bucketId, post_id] });
  if (existing[0]) { res.status(409).json({ error: "Already in bucket" }); return; }

  await db.execute({ sql: "INSERT INTO bucket_posts (bucket_id, post_id) VALUES (?, ?)", args: [bucketId, post_id] });
  res.status(201).json({ message: "added" });
});

router.delete("/:id/posts/:postId", async (req, res) => {
  const user_id = req.user!.id;
  const bucketId = Number(req.params.id);
  const postId   = Number(req.params.postId);
  if (isNaN(bucketId) || isNaN(postId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
  const bucket = bucketRows[0] as unknown as Bucket | undefined;
  if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
  if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  const result = await db.execute({ sql: "DELETE FROM bucket_posts WHERE bucket_id = ? AND post_id = ?", args: [bucketId, postId] });
  if (result.rowsAffected === 0) { res.status(404).json({ error: "Post not in bucket" }); return; }
  res.json({ message: "removed" });
});

router.delete("/:id", async (req, res) => {
  const user_id = req.user!.id;
  const bucketId = Number(req.params.id);
  if (isNaN(bucketId)) { res.status(400).json({ error: "Invalid bucket id" }); return; }

  const { rows: bucketRows } = await db.execute({ sql: "SELECT * FROM buckets WHERE id = ?", args: [bucketId] });
  const bucket = bucketRows[0] as unknown as Bucket | undefined;
  if (!bucket) { res.status(404).json({ error: "Bucket not found" }); return; }
  if (bucket.user_id !== user_id) { res.status(403).json({ error: "Permission denied" }); return; }

  await db.batch([
    { sql: "DELETE FROM bucket_posts WHERE bucket_id = ?", args: [bucketId] },
    { sql: "DELETE FROM buckets WHERE id = ?", args: [bucketId] },
  ], "write");
  res.json({ message: "deleted" });
});

export default router;
