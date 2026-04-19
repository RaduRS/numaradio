// Side-effect module — import this FIRST in any standalone script
// before any other module reads process.env.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const localPath = join(process.cwd(), ".env.local");
if (existsSync(localPath)) config({ path: localPath });
else config();
