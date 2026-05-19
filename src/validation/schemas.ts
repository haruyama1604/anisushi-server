import { z } from "zod";

// 共通: trim 済みで N 文字までの本文（投稿・コメント・返信に使い回す）
const trimmedText = (max: number, label: string) =>
  z.string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const CreatePostBody = z.object({
  content: trimmedText(80, "content"),
  room: z.string().trim().max(50, "room must be 50 characters or fewer").optional().default(""),
  spoiler: z.boolean().optional().default(false),
});

export const CreateCommentBody = z.object({
  text: trimmedText(80, "text"),
});

export const CreateReplyBody = z.object({
  text: trimmedText(80, "text"),
});

export const CreateBucketBody = z.object({
  name: trimmedText(20, "name"),
});

export const AddPostToBucketBody = z.object({
  post_id: z.number().int().positive(),
});

// 型をエクスポート（route handler 側で z.infer 不要にする）
export type CreatePostBody     = z.infer<typeof CreatePostBody>;
export type CreateCommentBody  = z.infer<typeof CreateCommentBody>;
export type CreateReplyBody    = z.infer<typeof CreateReplyBody>;
export type CreateBucketBody   = z.infer<typeof CreateBucketBody>;
export type AddPostToBucketBody = z.infer<typeof AddPostToBucketBody>;
