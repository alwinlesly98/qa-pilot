import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const NAMES = WIN ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"];

function onPath(): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of NAMES) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** Newest "<prefix>-<version>[-platform]" folder in an editor's extensions directory. */
function newestExtension(extensionsDir: string): string | null {
  if (!fs.existsSync(extensionsDir)) return null;
  const versionOf = (name: string) => (name.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? [0, 0, 0]);
  const dirs = fs.readdirSync(extensionsDir).filter((d) => d.startsWith("anthropic.claude-code-"));
  dirs.sort((a, b) => {
    const [x, y] = [versionOf(a), versionOf(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  for (const d of dirs.reverse()) {
    for (const name of NAMES) {
      const file = path.join(extensionsDir, d, "resources", "native-binary", name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/**
 * Locate the Claude Code CLI. An explicit path in Settings wins; otherwise PATH, the native
 * installer location, npm/nvm global installs, and finally the binary bundled with the
 * VS Code / Cursor extension (which shares the same login).
 */
export function findClaude(configured: string | undefined): string | null {
  if (configured && configured.trim() && configured.trim() !== "claude") return configured.trim();
  const fromPath = onPath();
  if (fromPath) return fromPath;
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const candidates = [
    ...NAMES.map((n) => path.join(home, ".local", "bin", n)),
    ...NAMES.map((n) => path.join(home, ".claude", "local", n)),
    ...(WIN ? [path.join(appData, "npm", "claude.cmd")] : ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"]),
  ];
  const nvmDir = path.join(appData, "nvm");
  if (WIN && fs.existsSync(nvmDir)) for (const v of fs.readdirSync(nvmDir)) candidates.push(path.join(nvmDir, v, "claude.cmd"));
  for (const file of candidates) if (fs.existsSync(file)) return file;
  for (const editor of [".vscode", ".vscode-insiders", ".cursor", ".windsurf", ".antigravity"]) {
    const found = newestExtension(path.join(home, editor, "extensions"));
    if (found) return found;
  }
  return null;
}
