import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR } from "../config";
import { all, get } from "../db";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function inlineImage(fileOrUrl: string | null | undefined): string | null {
  if (!fileOrUrl) return null;
  const file = fileOrUrl.startsWith("/artifacts/") ? path.join(ARTIFACTS_DIR, fileOrUrl.slice("/artifacts/".length)) : fileOrUrl;
  if (!fs.existsSync(file)) return null;
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

const STATUS_COLOR: Record<string, string> = {
  passed: "#16a34a", failed: "#dc2626", blocked: "#d97706", flaky: "#9333ea", error: "#64748b", cancelled: "#64748b", pending: "#64748b",
};

/** Self-contained HTML report (images embedded) that can be emailed or attached anywhere. */
export function buildRunReport(runId: string): string {
  const run = get("runs", runId);
  if (!run) throw new Error("Run not found");
  const project = get("projects", run.project_id)!;
  const build = run.build_id ? get("builds", run.build_id) : undefined;
  const results = all("SELECT * FROM results WHERE run_id=? ORDER BY rowid", runId);
  const issues = all("SELECT * FROM issues WHERE run_id=?", runId);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const total = results.length || 1;
  const passRate = Math.round((count("passed") / total) * 100);
  const summary = run.ai_summary ? JSON.parse(run.ai_summary) : null;

  const CHECK_ICON: Record<string, string> = { passed: "✔", failed: "✘", not_run: "–" };
  const rows = results
    .map((r) => {
      const testIssues = issues.filter((i) => i.result_id === r.id && ["functional", "validation", "navigation"].includes(i.category));
      const issue = testIssues[0];
      const checks = ((r.checks as any[]) ?? []).map((c) => `<tr class="${c.status}"><td>${CHECK_ICON[c.status] ?? ""}</td><td>${esc(c.id)}</td><td>${esc(c.text)}</td><td>${esc(c.observation ?? c.reason ?? "")}</td></tr>`).join("");
      const lastShot = [...r.steps].reverse().find((s: any) => s.screenshot)?.screenshot;
      const img = inlineImage(issue?.annotated_path || issue?.screenshot_path || lastShot);
      const steps = r.steps
        .map((s: any) => `<li class="${s.ok ? "" : "err"}"><b>${esc(s.action.type)}</b> ${esc(s.action.description)} — <span>${esc(s.result)}</span>${
          s.verification ? `<div class="ver ${s.verification.passed ? "ok" : "bad"}">${s.verification.passed ? "✔" : "✘"} ${esc(s.verification.expectation)} — ${esc(s.verification.observation)}</div>` : ""
        }</li>`)
        .join("");
      return `<section class="tc">
  <header><span class="badge" style="background:${STATUS_COLOR[r.status] ?? "#64748b"}">${esc(r.status)}</span>
  <h3>${esc(r.test_case.code)} · ${esc(r.test_case.title)}</h3><small>${r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : ""}</small></header>
  <p>${esc(r.summary)}</p>
  ${checks ? `<table class="checks"><thead><tr><th></th><th>Check</th><th>Expectation</th><th>Observed / reason</th></tr></thead><tbody>${checks}</tbody></table>` : ""}
  ${testIssues.map((issue) => `<div class="issue"><b>Defect${issue.check_id ? ` (${esc(issue.check_id)})` : ""}:</b> ${esc(issue.title)}${issue.jira_key ? ` · <a href="${esc(issue.jira_url)}">${esc(issue.jira_key)}</a>` : ""}<br><b>Expected:</b> ${esc(issue.expected)}<br><b>Actual:</b> ${esc(issue.actual)}<br><b>Comment:</b> ${esc(issue.reviewer_comment || issue.ai_comment)}</div>`).join("")}
  ${img ? `<img src="${img}" alt="screenshot">` : ""}
  <details><summary>${r.steps.length} executed steps</summary><ol>${steps}</ol></details>
</section>`;
    })
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(project.name)} · ${esc(run.name)} · Test report</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:1100px;margin:auto;padding:24px 16px}
h1{margin:0 0 4px}.meta{color:#475569}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 0}
.stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}.stat b{font-size:24px;display:block}
.summary{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px}
.tc{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:12px 0}
.tc header{display:flex;gap:10px;align-items:center}.tc h3{margin:0;font-size:16px;flex:1}
.badge{color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;text-transform:uppercase;font-weight:600}
.issue{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;margin:8px 0}
img{max-width:100%;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px}
li.err span{color:#dc2626}
table.checks{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}table.checks th,table.checks td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left;vertical-align:top}
tr.passed td:first-child{color:#16a34a}tr.failed td{background:#fef2f2}tr.failed td:first-child{color:#dc2626}tr.not_run td{color:#64748b}
.fe{display:grid;grid-template-columns:200px 1fr;gap:12px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:8px 0}.fe img{margin:0}
.cat{display:inline-block;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:600;background:#eef2ff;color:#4338ca;text-transform:uppercase}.ver{font-size:12px}.ver.ok{color:#16a34a}.ver.bad{color:#dc2626}
</style></head><body><main>
<h1>${esc(project.name)} — Test report</h1>
<div class="meta">${esc(run.name)} · Build ${esc(build?.version ?? "-")} ${build?.commit_sha ? `(${esc(build.commit_sha.slice(0, 8))})` : ""} · Device ${esc(run.device)} · ${esc(run.started_at ?? "")}</div>
<div class="stats">
<div class="stat"><b>${passRate}%</b>Pass rate</div>
<div class="stat"><b style="color:#16a34a">${count("passed")}</b>Passed</div>
<div class="stat"><b style="color:#dc2626">${count("failed")}</b>Failed</div>
<div class="stat"><b style="color:#d97706">${count("blocked")}</b>Blocked</div>
<div class="stat"><b style="color:#9333ea">${count("flaky")}</b>Flaky</div>
<div class="stat"><b>${issues.length}</b>Defects</div>
</div>
${summary ? `<div class="summary"><b>${esc(summary.verdict.replace(/_/g, " ").toUpperCase())}</b> — ${esc(summary.headline)}
<ul>${summary.highlights.map((h: string) => `<li>${esc(h)}</li>`).join("")}</ul>
${summary.risks.length ? `<b>Risks</b><ul>${summary.risks.map((h: string) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}</div>` : ""}
${rows}
${(() => {
  const fe = issues.filter((i) => ["frontend", "accessibility", "content"].includes(i.category));
  if (!fe.length) return "";
  return `<h2>Front-end, content &amp; accessibility (${fe.length})</h2>` + fe.map((i) => {
    const img = inlineImage(i.annotated_path || i.screenshot_path);
    return `<div class="fe">${img ? `<img src="${img}" alt="">` : "<div></div>"}<div><span class="cat">${esc(i.category)}</span> <b>${esc(i.title)}</b> <small>(${esc(i.severity)})</small><p>${esc(i.description).replace(/\n/g, "<br>")}</p><b>Expected:</b> ${esc(i.expected)}</div></div>`;
  }).join("");
})()}
</main></body></html>`;
}
