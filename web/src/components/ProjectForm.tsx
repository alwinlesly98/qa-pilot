import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Database, GitBranch, Globe, KeyRound, Lock, Plus, Ticket, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Project, Variable } from "../lib/types";
import { Field, Spinner } from "./ui";

export interface ProjectInput {
  name: string;
  site_url: string;
  login_url: string;
  username: string;
  password?: string | null;
  login_notes: string;
  git_url: string;
  git_branch: string;
  git_token?: string | null;
  jira_project_key: string;
  default_device: string;
  variables: Variable[];
}

export function useDevices() {
  const [devices, setDevices] = useState<string[]>(["Desktop Chrome"]);
  useEffect(() => {
    api.get<{ devices: string[] }>("/meta").then((m) => setDevices(m.devices)).catch(() => {});
  }, []);
  return devices;
}

function Section({ icon, title, desc, children }: { icon: ReactNode; title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 border-b border-slate-100 py-7 first:pt-0 last:border-0 lg:grid-cols-3">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{desc}</p>
      </div>
      <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">{children}</div>
    </div>
  );
}

const SUGGESTED = ["OTP", "EXISTING_EMAIL", "TEST_EMAIL", "TEST_PHONE", "ADMIN_URL", "ADMIN_USERNAME", "ADMIN_PASSWORD"];

function VariablesEditor({ value, onChange }: { value: Variable[]; onChange: (v: Variable[]) => void }) {
  const set = (i: number, patch: Partial<Variable>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const unused = SUGGESTED.filter((k) => !value.some((v) => v.key === k));
  return (
    <div className="space-y-2 sm:col-span-2">
      {value.length > 0 && (
        <div className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Name</span>
          <span>Value</span>
          <span>Secret</span>
          <span />
        </div>
      )}
      {value.map((v, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
          <input className="input font-mono text-[13px] uppercase" value={v.key} onChange={(e) => set(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} placeholder="OTP" />
          <input
            className="input"
            type={v.secret ? "password" : "text"}
            value={v.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={v.secret && v.has_value ? "•••••••• (saved)" : "value"}
            autoComplete="new-password"
          />
          <button type="button" onClick={() => set(i, { secret: !v.secret, value: "" })} className={`grid h-9 w-9 place-items-center rounded-lg border ${v.secret ? "border-brand-200 bg-brand-50 text-brand-600" : "border-slate-200 text-slate-400"}`} title="Secret values are encrypted and never shown to Claude">
            <Lock className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost p-2 text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => onChange([...value, { key: "", value: "", secret: false }])}>
          <Plus className="h-3.5 w-3.5" /> Add variable
        </button>
        {unused.map((k) => (
          <button key={k} type="button" onClick={() => onChange([...value, { key: k, value: "", secret: /PASSWORD|OTP/.test(k) }])} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 font-mono text-[11px] text-slate-500 hover:border-brand-500 hover:text-brand-600">
            + {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ProjectForm({ project, onSubmit, submitLabel }: { project?: Project; onSubmit: (v: ProjectInput) => Promise<void>; submitLabel: string }) {
  const devices = useDevices();
  const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState<ProjectInput>({
    name: project?.name ?? "",
    site_url: project?.site_url ?? "",
    login_url: project?.login_url ?? "",
    username: project?.username ?? "",
    password: "",
    login_notes: project?.login_notes ?? "",
    git_url: project?.git_url ?? "",
    git_branch: project?.git_branch ?? "",
    git_token: "",
    jira_project_key: project?.jira_project_key ?? "",
    default_device: project?.default_device ?? "Desktop Chrome",
    variables: project?.variables ?? [],
  });
  const set = (k: keyof ProjectInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    api.get<{ key: string; name: string }[]>("/jira/projects").then(setJiraProjects).catch(() => setJiraProjects(null));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const out = { ...v, variables: v.variables.filter((x) => x.key) };
      if (!out.password) delete out.password; // keep the stored secret unless a new one is typed
      if (!out.git_token) delete out.git_token;
      await onSubmit(out);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card p-7">
      <Section icon={<Globe className="h-4 w-4" />} title="Application" desc="The site under test. A build can override the URL (e.g. a staging deploy).">
        <Field label="Project name"><input className="input" required value={v.name} onChange={set("name")} placeholder="VeriChain website" /></Field>
        <Field label="Site URL"><input className="input" required type="url" value={v.site_url} onChange={set("site_url")} placeholder="https://staging.example.com" /></Field>
        <Field label="Default device" hint="Mobile devices are emulated (viewport, touch, user agent).">
          <select className="input" value={v.default_device} onChange={set("default_device")}>
            {devices.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
      </Section>

      <Section icon={<KeyRound className="h-4 w-4" />} title="Customer login" desc="Used for test cases that start signed in. Encrypted at rest — Claude only types the {{USERNAME}} / {{PASSWORD}} placeholders.">
        <Field label="Login page URL"><input className="input" value={v.login_url} onChange={set("login_url")} placeholder="https://staging.example.com/login" /></Field>
        <Field label="Username / email"><input className="input" value={v.username} onChange={set("username")} autoComplete="off" /></Field>
        <Field label="Password">
          <input className="input" type="password" value={v.password ?? ""} onChange={set("password")} autoComplete="new-password" placeholder={project?.has_password ? "•••••••• (saved — type to replace)" : ""} />
        </Field>
        <Field label="Login notes" hint="e.g. 'Select tenant Acme after login'">
          <input className="input" value={v.login_notes} onChange={set("login_notes")} />
        </Field>
      </Section>

      <Section
        icon={<Database className="h-4 w-4" />}
        title="Test data"
        desc={<>Values test cases can use as <code className="rounded bg-slate-100 px-1 font-mono text-xs">{"{{NAME}}"}</code> — e.g. a staging OTP, an email that already has an account, or admin-panel credentials. Secrets are encrypted and hidden from Claude.</>}
      >
        <VariablesEditor value={v.variables} onChange={(variables) => setV({ ...v, variables })} />
      </Section>

      <Section icon={<GitBranch className="h-4 w-4" />} title="Source code" desc="Optional. Claude reads routes, forms and test ids from the repository to test more accurately.">
        <Field label="Git URL"><input className="input" value={v.git_url} onChange={set("git_url")} placeholder="https://github.com/org/app.git" /></Field>
        <Field label="Branch"><input className="input" value={v.git_branch} onChange={set("git_branch")} placeholder="main" /></Field>
        <Field label="Access token" hint="For private repos (GitHub/GitLab/Bitbucket).">
          <input className="input" type="password" value={v.git_token ?? ""} onChange={set("git_token")} autoComplete="new-password" placeholder={project?.has_git_token ? "•••••••• (saved)" : ""} />
        </Field>
      </Section>

      <Section icon={<Ticket className="h-4 w-4" />} title="Jira" desc="Approved defects are created in this Jira project.">
        <Field label="Jira project" hint={jiraProjects ? undefined : "Connect Jira in Settings to pick from a list."}>
          {jiraProjects ? (
            <select className="input" value={v.jira_project_key} onChange={set("jira_project_key")}>
              <option value="">— none —</option>
              {jiraProjects.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
            </select>
          ) : (
            <input className="input" value={v.jira_project_key} onChange={set("jira_project_key")} placeholder="VC" />
          )}
        </Field>
      </Section>

      <div className="flex justify-end pt-2">
        <button className="btn-primary" disabled={saving}>{saving && <Spinner />}{submitLabel}</button>
      </div>
    </form>
  );
}
