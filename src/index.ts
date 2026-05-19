import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb } from "./db/init";
import authRouter from "./routes/auth";
import postsRouter from "./routes/posts";
import commentsRouter from "./routes/comments";
import bucketsRouter from "./routes/buckets";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
app.use(cors({ origin: ["https://anisushi-client.vercel.app", "http://localhost:5173"] }));
app.use(express.json());

app.use("/auth", authRouter);
app.use("/posts", postsRouter);
app.use(commentsRouter);
app.use("/buckets", bucketsRouter);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)))
  .catch((e) => { console.error("DB init failed:", e); process.exit(1); });
