// Zip QA Pilot for installing on another computer.
//   npm run bundle               -> code only (fresh install on the other machine)
//   npm run bundle -- --with-data -> also the database + encryption key (projects, stories,
//                                  test cases, settings and saved secrets), without run videos/screenshots
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withData = process.argv.includes("--with-data");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "data", "test-results", "playwright-report"]);
const SKIP_FILES = new Set([".env"]);

const zip = new JSZip();
const top = zip.folder("qa-pilot");
let count = 0;

function add(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) add(full);
    } else if (!SKIP_FILES.has(entry.name) && !entry.name.endsWith(".zip")) {
      top.file(rel, fs.readFileSync(full), { unixPermissions: entry.name.endsWith(".sh") ? 0o755 : 0o644 });
      count++;
    }
  }
}
add(root);

if (withData) {
  const dataDir = process.env.QA_DATA_DIR ? path.resolve(process.env.QA_DATA_DIR) : path.join(root, "data");
  const db = path.join(dataDir, "qa-pilot.db");
  if (!fs.existsSync(db)) throw new Error(`No database found at ${db}`);
  // Copy through SQLite so the snapshot is consistent even while the server is running.
  const Database = require("better-sqlite3");
  const snapshot = path.join(root, "qa-pilot-snapshot.db");
  await new Database(db, { readonly: true }).backup(snapshot);
  top.file("data/qa-pilot.db", fs.readFileSync(snapshot));
  fs.rmSync(snapshot);
  top.file("data/secret.key", fs.readFileSync(path.join(dataDir, "secret.key")));
  for (const sub of ["suites"]) {
    const dir = path.join(dataDir, sub);
    if (fs.existsSync(dir)) {
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else top.file(`data/${path.relative(dataDir, f).split(path.sep).join("/")}`, fs.readFileSync(f));
        }
      };
      walk(dir);
    }
  }
}

const stamp = new Date().toISOString().slice(0, 10);
const out = path.join(root, `qa-pilot-${stamp}${withData ? "-with-data" : ""}.zip`);
fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" }));
console.log(`Created ${out} (${count} files${withData ? " + data" : ""}, ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
if (withData) console.log("This zip contains your encryption key and saved secrets - share it only with people who may see them.");
