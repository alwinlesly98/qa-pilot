import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} />;
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  indigo: "bg-brand-50 text-brand-700 ring-brand-600/20",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  pink: "bg-pink-50 text-pink-700 ring-pink-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  passed: "green", passing: "green", completed: "green", sent: "green", pass: "green", ready: "green", auto: "green",
  failed: "red", failing: "red", error: "red", critical: "red", high: "red", not_ready: "red", contradiction: "red",
  blocked: "amber", medium: "amber", partial: "amber", ready_with_risks: "amber", ambiguity: "amber",
  major: "orange", gap: "orange",
  flaky: "purple", typo: "purple", content: "purple",
  running: "blue", approved: "blue", functional: "blue", validation: "blue", navigation: "blue",
  frontend: "cyan", accessibility: "pink", risk: "pink",
  draft: "slate", queued: "slate", pending: "slate", minor: "slate", trivial: "slate", low: "slate", manual: "slate", cancelled: "slate", rejected: "slate", not_run: "slate", broken: "red",
};

const LABELS: Record<string, string> = { failing: "fails · known defect", not_run: "not run", ready_with_risks: "ready with risks", not_ready: "not ready", rejected: "not a bug" };

export function Badge({ value, tone, className = "", children }: { value?: string; tone?: Tone; className?: string; children?: ReactNode }) {
  const t = tone ?? STATUS_TONE[value ?? ""] ?? "slate";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${TONES[t]} ${className}`}>
      {value === "running" && <Spinner className="h-3 w-3" />}
      {children ?? LABELS[value ?? ""] ?? (value ?? "").replace(/_/g, " ")}
    </span>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, subtitle, children, size = "md" }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; size?: "md" | "lg" | "xl" }) {
  useEscape(open, onClose);
  if (!open) return null;
  const width = { md: "max-w-xl", lg: "max-w-4xl", xl: "max-w-6xl" }[size];
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className={`card mt-[6vh] w-full ${width} shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/** Slide-over panel from the right, for editing a row without leaving the table. */
export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[1px]" onMouseDown={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">{icon}</div>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`tab flex items-center gap-2 whitespace-nowrap ${value === t.key ? "tab-active" : ""}`}>
          {t.icon}
          {t.label}
          {t.count != null && <span className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${value === t.key ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${value === o.key ? "bg-white font-medium text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"}`}>
          {o.label}
          {o.count != null && <span className="text-xs tabular-nums text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone = "slate", hint, icon }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode; icon?: ReactNode }) {
  const accent: Record<Tone, string> = {
    green: "text-emerald-600", red: "text-red-600", amber: "text-amber-600", orange: "text-orange-600", purple: "text-purple-600",
    blue: "text-blue-600", indigo: "text-brand-600", cyan: "text-cyan-600", pink: "text-pink-600", slate: "text-slate-900",
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {icon && <span className={accent[tone]}>{icon}</span>}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-slate-500">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; kind: "success" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="card flex items-start gap-2.5 p-3.5 text-sm shadow-lg">
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
            <span className="break-words text-slate-700">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wrap an async action with loading state and error toasts. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const out = await fn();
        if (success) toast("success", success);
        return out;
      } catch (e) {
        toast("error", (e as Error).message);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}
