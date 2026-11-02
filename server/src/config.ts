import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "../..");
dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true });

export const DATA_DIR = process.env.QA_DATA_DIR ? path.resolve(process.env.QA_DATA_DIR) : path.join(ROOT_DIR, "data");
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export const REPOS_DIR = path.join(DATA_DIR, "repos");
export const WEB_DIST = path.join(ROOT_DIR, "web", "dist");
export const PORT = Number(process.env.PORT || 4300);
/** "localhost" keeps QA Pilot private to this computer; "0.0.0.0" shares it on the network. */
export const HOST = process.env.HOST || "localhost";

for (const dir of [DATA_DIR, ARTIFACTS_DIR, REPOS_DIR]) fs.mkdirSync(dir, { recursive: true });

/** Convert an absolute artifact path into the URL it is served at. */
export function artifactUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const rel = path.relative(ARTIFACTS_DIR, absPath).split(path.sep).join("/");
  return `/artifacts/${rel}`;
}
