import { useEffect, useState } from "react";
import { Bot, Mail, PlugZap, Save, Ticket, Workflow } from "lucide-react";
import { api } from "../lib/api";
import type { Settings as S } from "../lib/types";
import { Field, Spinner, useAction } from "../components/ui";

const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (most accurate, recommended)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (faster, lower cost)"],
  ["claude-fable-5-1", "Claude Fable 5.1 (most capable, highest cost)"],
];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" onClick={() => onChange(!checked)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-brand-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
      <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-slate-500">{hint}</span></span>
    </label>
  );
}

export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [mailPass, setMailPass] = useState("");
  const { busy, run } = useAction();
  useEffect(() => void api.get<S>("/settings").then(setS), []);
  if (!s) return <Spinner className="h-6 w-6 text-slate-400" />;

  const save = () =>
    run("save", async () => {
      const out = await api.put<S>("/settings", {
        ai: { ...s.ai, ...(apiKey ? { apiKey } : {}) },
        jira: { ...s.jira, ...(jiraToken ? { token: jiraToken } : {}) },
        runner: s.runner,
        mailbox: { ...s.mailbox, ...(mailPass ? { password: mailPass } : {}) },
      });
      setMailPass("");
      setS(out);
      setApiKey("");
      setJiraToken("");
    }, "Settings saved");

  const test = (what: "ai" | "jira" | "mailbox") =>
    run(`test-${what}`, async () => {
      await save();
      const r = await api.post<{ message: string }>(`/settings/test-${what}`);
      return r;
    }).then((r) => r && alert(`✅ ${r.message}`));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-slate-500">Secrets are encrypted at rest and never sent back to the browser.</p>
        </div>
        <button className="btn-primary" disabled={!!busy} onClick={save}>{busy === "save" ? <Spinner /> : <Save className="h-4 w-4" />} Save</button>
      </div>

      <div className="card space-y-5 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Bot className="h-4 w-4 text-brand-600" /> Claude</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["claude-code", "Claude subscription", "Uses the Claude Code CLI logged in with your Pro / Max / Team account. Run once: npm i -g @anthropic-ai/claude-code && claude login"],
            ["api", "Anthropic API key", "Pay-as-you-go API from console.anthropic.com. Faster and recommended for team/CI use."],
          ] as const).map(([value, title, desc]) => (
            <button key={value} type="button" onClick={() => setS({ ...s, ai: { ...s.ai, provider: value } })} className={`rounded-xl border p-4 text-left transition ${s.ai.provider === value ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"}`}>
              <div className="font-medium">{title}</div>
              <div className="mt-1 text-xs text-slate-500">{desc}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            <select className="input" value={s.ai.model} onChange={(e) => setS({ ...s, ai: { ...s.ai, model: e.target.value } })}>
              {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {s.ai.provider === "api" ? (
            <Field label="API key" hint={s.ai.hasApiKey ? "A key is saved. Type a new one to replace it." : undefined}>
              <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={s.ai.hasApiKey ? "••••••••••••" : "sk-ant-…"} autoComplete="off" />
            </Field>
          ) : (
            <Field
              label="Claude CLI command"
              hint={
                s.ai.detectedClaudePath ? (
                  <span className="text-emerald-700">Using: <span className="break-all font-mono">{s.ai.detectedClaudePath}</span></span>
                ) : (
                  <span className="text-red-600">Claude Code not found. Install it (npm i -g @anthropic-ai/claude-code, then claude login) or enter its full path.</span>
                )
              }
            >
              <input className="input font-mono" value={s.ai.claudePath} onChange={(e) => setS({ ...s, ai: { ...s.ai, claudePath: e.target.value } })} />
            </Field>
          )}
        </div>
        <button className="btn-secondary" disabled={!!busy} onClick={() => test("ai")}>{busy === "test-ai" ? <Spinner /> : <PlugZap className="h-4 w-4" />} Test Claude connection</button>
      </div>

      <div className="card space-y-5 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Ticket className="h-4 w-4 text-brand-600" /> Jira</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jira type">
            <select className="input" value={s.jira.type} onChange={(e) => setS({ ...s, jira: { ...s.jira, type: e.target.value as "cloud" | "server" } })}>
              <option value="cloud">Jira Cloud (atlassian.net)</option>
              <option value="server">Jira Server / Data Center</option>
            </select>
          </Field>
          <Field label="Base URL"><input className="input" value={s.jira.baseUrl} onChange={(e) => setS({ ...s, jira: { ...s.jira, baseUrl: e.target.value } })} placeholder="https://your-company.atlassian.net" /></Field>
          {s.jira.type === "cloud" && (
            <Field label="Account email"><input className="input" value={s.jira.email} onChange={(e) => setS({ ...s, jira: { ...s.jira, email: e.target.value } })} /></Field>
          )}
          <Field label={s.jira.type === "cloud" ? "API token" : "Personal access token"} hint={s.jira.type === "cloud" ? "Create at id.atlassian.com → Security → API tokens" : undefined}>
            <input className="input" type="password" value={jiraToken} onChange={(e) => setJiraToken(e.target.value)} placeholder={s.jira.hasToken ? "•••••••• (saved)" : ""} autoComplete="off" />
          </Field>
        </div>
        <button className="btn-secondary" disabled={!!busy} onClick={() => test("jira")}>{busy === "test-jira" ? <Spinner /> : <PlugZap className="h-4 w-4" />} Test Jira connection</button>
      </div>

      <div className="card space-y-5 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Workflow className="h-4 w-4 text-brand-600" /> Test runner</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Toggle checked={!s.runner.headless} onChange={(v) => setS({ ...s, runner: { ...s.runner, headless: !v } })} label="Show browser window" hint="Off = headless. The live view in QA Pilot works either way." />
          <Toggle checked={s.runner.confirmFailures} onChange={(v) => setS({ ...s, runner: { ...s.runner, confirmFailures: v } })} label="Confirm failures" hint="Re-run a failed test once; failures that pass on retry are marked flaky instead of raising a bug." />
          <Toggle checked={s.runner.video} onChange={(v) => setS({ ...s, runner: { ...s.runner, video: v } })} label="Record video" hint="A .webm recording per test." />
          <Toggle checked={s.runner.trace} onChange={(v) => setS({ ...s, runner: { ...s.runner, trace: v } })} label="Playwright trace" hint="DOM snapshots and network log for deep debugging." />
          <Toggle checked={s.runner.frontendReview} onChange={(v) => setS({ ...s, runner: { ...s.runner, frontendReview: v } })} label="Front-end review" hint="On every new screen: WCAG 2.2 AA scan, layout checks and a Claude visual review against the story." />
          <Field label="Max AI steps per test" hint="Safety limit for the agent loop.">
            <input className="input w-32" type="number" min={5} max={200} value={s.runner.maxSteps} onChange={(e) => setS({ ...s, runner: { ...s.runner, maxSteps: Number(e.target.value) } })} />
          </Field>
          <Field label="Max visual reviews per run" hint="Claude screenshot reviews of distinct screens (cost control).">
            <input className="input w-32" type="number" min={0} max={100} value={s.runner.maxVisualReviews} onChange={(e) => setS({ ...s, runner: { ...s.runner, maxVisualReviews: Number(e.target.value) } })} />
          </Field>
        </div>
      </div>

      <div className="card space-y-5 p-6">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-brand-600" /> Test inbox</h2>
          <p className="mt-1 text-sm text-slate-500">
            A mailbox the test emails go to (OTP codes, confirmation emails). Claude reads it with the <code className="font-mono text-xs">read_email</code> action. For Gmail use imap.gmail.com with an App Password; set the test case email (e.g. a <code className="font-mono text-xs">{"{{TEST_EMAIL}}"}</code> variable) to this address or a +alias of it.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="IMAP host"><input className="input" value={s.mailbox.host} onChange={(e) => setS({ ...s, mailbox: { ...s.mailbox, host: e.target.value } })} placeholder="imap.gmail.com" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port"><input className="input" type="number" value={s.mailbox.port} onChange={(e) => setS({ ...s, mailbox: { ...s.mailbox, port: Number(e.target.value) } })} /></Field>
            <Field label="TLS">
              <select className="input" value={s.mailbox.secure ? "1" : "0"} onChange={(e) => setS({ ...s, mailbox: { ...s.mailbox, secure: e.target.value === "1" } })}>
                <option value="1">Yes (993)</option>
                <option value="0">No / STARTTLS</option>
              </select>
            </Field>
          </div>
          <Field label="Username"><input className="input" value={s.mailbox.user} onChange={(e) => setS({ ...s, mailbox: { ...s.mailbox, user: e.target.value } })} placeholder="qa-inbox@yourcompany.com" /></Field>
          <Field label="Password / app password">
            <input className="input" type="password" value={mailPass} onChange={(e) => setMailPass(e.target.value)} placeholder={s.mailbox.hasPassword ? "•••••••• (saved)" : ""} autoComplete="new-password" />
          </Field>
        </div>
        <button className="btn-secondary" disabled={!!busy} onClick={() => test("mailbox")}>{busy === "test-mailbox" ? <Spinner /> : <PlugZap className="h-4 w-4" />} Test inbox connection</button>
      </div>
    </div>
  );
}
