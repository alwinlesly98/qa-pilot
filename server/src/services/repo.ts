import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { aiJson } from "../ai/claude";
import { REPO_SYSTEM } from "../ai/prompts";
import { AppContext } from "../ai/schemas";
import { REPOS_DIR } from "../config";
import { decrypt } from "../crypto";
import { now, Row, update } from "../db";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "vendor", "coverage", "__pycache__", ".venv", "venv", "target", "bin", "obj", ".idea", ".vscode", "public", "assets", "storage"]);
const CODE_EXT = /\.(tsx?|jsx?|vue|svelte|html?|php|py|rb|java|kt|cs|cshtml|razor|go|dart|swift)$/i;
const KEY_FILE = /(route|router|routes|urls|navigation|nav|menu|app|page|layout|login|auth|signin|form)[^/]*\.[a-z]+$|(^|\/)(pages|app|views|screens)\//i;

function git(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.replace(/\/\/[^@\s]+@/g, "//***@").trim() || `git exited ${code}`))));
  });
}

function authedUrl(url: string, token: string | null) {
  if (!token || !/^https?:\/\//.test(url)) return url;
  const u = new URL(url);
  u.username = "oauth2";
  u.password = token;
  return u.toString();
}

/** Shallow-clone (or refresh) the project repository at the given branch. */
export async function syncRepo(project: Row, branch?: string | null): Promise<string> {
  if (!project.git_url) throw new Error("This project has no Git URL.");
  const dir = path.join(REPOS_DIR, project.id);
  const ref = branch || project.git_branch || "";
  fs.rmSync(dir, { recursive: true, force: true });
  const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), authedUrl(project.git_url, decrypt(project.git_token_enc)), dir];
  await git(args);
  return dir;
}

function walk(dir: string, root: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, root, out);
    } else if (CODE_EXT.test(entry.name) || /^(readme|package\.json|composer\.json|pubspec\.yaml)/i.test(entry.name)) {
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
}

/** Pick files most useful to a tester, within a character budget. */
function collectSources(dir: string, budget = 120_000) {
  const files: string[] = [];
  walk(dir, dir, files);
  const score = (f: string) => (/readme/i.test(f) ? 0 : /package\.json$/.test(f) ? 1 : KEY_FILE.test(f) ? 2 : /test|spec|stories/i.test(f) ? 9 : 5);
  const ranked = [...files].sort((a, b) => score(a) - score(b) || a.length - b.length);
  let used = 0;
  const chunks: string[] = [];
  for (const f of ranked) {
    if (score(f) > 5 || used > budget) break;
    let text = fs.readFileSync(path.join(dir, f), "utf8");
    if (text.length > 12_000) text = text.slice(0, 12_000) + "\n…(truncated)";
    used += text.length;
    chunks.push(`=== ${f} ===\n${text}`);
  }
  return { tree: files.slice(0, 600).join("\n"), sources: chunks.join("\n\n") };
}

export function formatContext(ctx: AppContext): string {
  const pages = ctx.pages.map((p) => `- ${p.route}: ${p.purpose}${p.key_elements ? ` [${p.key_elements}]` : ""}`).join("\n");
  return [`Summary: ${ctx.summary}`, `Stack: ${ctx.tech_stack}`, `Pages:\n${pages}`, ctx.auth && `Auth: ${ctx.auth}`, ctx.testing_notes && `Notes: ${ctx.testing_notes}`]
    .filter(Boolean)
    .join("\n");
}

export async function analyzeRepo(project: Row, branch?: string | null) {
  const dir = await syncRepo(project, branch);
  const { tree, sources } = collectSources(dir);
  const ctx = await aiJson({
    system: REPO_SYSTEM,
    prompt: `Site under test: ${project.site_url}\n\nFILE TREE:\n${tree}\n\nKEY SOURCE FILES:\n${sources}\n\nDescribe the application for testers.`,
    schema: AppContext,
    effort: "medium",
  });
  return update("projects", project.id, { app_context: formatContext(ctx), app_context_updated_at: now() });
}
