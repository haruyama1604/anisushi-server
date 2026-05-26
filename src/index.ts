import "dotenv/config";
import { initDb } from "./db/init";
import { createApp } from "./app";
import { logger } from "./logger";

const PORT = Number(process.env.PORT) || 3000;
const app = createApp();

initDb()
  .then(() => app.listen(PORT, () => logger.info({ port: PORT }, "Server started")))
  .catch((err) => { logger.fatal({ err }, "DB init failed"); process.exit(1); });
