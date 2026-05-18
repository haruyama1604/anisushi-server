export type Post    = { id: number; content: string; likes: number; views: number; user_id: string; room: string; created_at: string; spoiler: number; tier?: string };
export type Comment = { id: number; post_id: number; text: string; user_id: string; likes: number; created_at: string; liked_by_user?: boolean };
export type Bucket  = { id: number; name: string; user_id: string; created_at: string };
export type Reply   = { id: number; comment_id: number; text: string; user_id: string; created_at: string };
