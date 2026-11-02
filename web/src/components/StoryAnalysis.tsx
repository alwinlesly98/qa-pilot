import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardCopy, ListChecks, Save, Sparkles, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import type { ReviewFinding, Story } from "../lib/types";
import { Badge, Empty, Field, Spinner, timeAgo, useAction, useToast } from "./ui";

const KIND_HELP: Record<ReviewFinding["kind"], string> = {
  contradiction: "Two statements cannot both be true",
  ambiguity: "Could be built in more than one way",
  gap: "Missing rule a developer/tester needs",
  typo: "Spelling or grammar that may leak into the UI",
  risk: "Hard to build or test, likely regression",
};

function ReviewCard({ f }: { f: ReviewFinding }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge value={f.kind} />
        <Badge value={f.severity} />
        <span className="text-xs text-slate-400">{KIND_HELP[f.kind]}</span>
      </div>
      <div className="mt-2 font-medium text-slate-900">{f.title}</div>
      <p className="mt-1 text-sm text-slate-600">{f.detail}</p>
      {f.quote && <blockquote className="mt-2 border-l-2 border-amber-300 bg-amber-50/60 px-3 py-1.5 text-[13px] italic text-slate-700">“{f.quote}”</blockquote>}
      {f.suggestion && <p className="mt-2 text-sm"><span className="font-medium text-brand-700">Ask / fix: </span><span className="text-slate-700">{f.suggestion}</span></p>}
    </div>
  );
}

export default function StoryAnalysis({ story, onChange, autoAnalyze, onGenerate }: { story: Story; onChange: (s: Story) => void; autoAnalyze: boolean; onGenerate: (guidance: string) => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState({ title: story.title, description: story.description, acceptance_criteria: story.acceptance_criteria, jira_key: story.jira_key ?? "" });
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const dirty = draft.title !== story.title || draft.description !== story.description || draft.acceptance_criteria !== story.acceptance_criteria || draft.jira_key !== (story.jira_key ?? "");

  const analyze = () => run("analyze", async () => onChange(await api.post<Story>(`/stories/${story.id}/analyze`)), "Story analysed");
  useEffect(() => {
    if (autoAnalyze && !story.requirements.length) void analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cov = useMemo(() => new Map(story.coverage.map((c) => [c.id, c.test_cases])), [story.coverage]);
  const sections = useMemo(() => {
    const m = new Map<string, Story["requirements"]>();
    for (const r of story.requirements) m.set(r.section, [...(m.get(r.section) ?? []), r]);
    return [...m.entries()];
  }, [story.requirements]);
  const uncovered = story.requirements.filter((r) => !cov.get(r.id)?.length);
  const sortedReview = [...story.review].sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity));

  const copyQuestions = async () => {
    const text = sortedReview.map((f, i) => `${i + 1}. [${f.kind}] ${f.title}\n   ${f.quote ? `Story says: "${f.quote}"\n   ` : ""}${f.suggestion}`).join("\n\n");
    await navigator.clipboard.writeText(`Questions on "${story.title}":\n\n${text}`);
    toast("success", "Questions copied — paste them to the product owner");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="card h-fit space-y-4 p-6 xl:sticky xl:top-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Title"><input className="input font-medium" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Jira key"><input className="input" value={draft.jira_key} onChange={(e) => setDraft({ ...draft, jira_key: e.target.value })} /></Field>
        </div>
        <Field label="Story">
          <textarea className="input min-h-[46vh] font-mono text-[12.5px] leading-relaxed" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        <Field label="Acceptance criteria"><textarea className="input min-h-[70px]" value={draft.acceptance_criteria} onChange={(e) => setDraft({ ...draft, acceptance_criteria: e.target.value })} /></Field>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" disabled={!dirty || !!busy} onClick={() => run("save", async () => onChange(await api.put<Story>(`/stories/${story.id}`, draft)), "Story saved")}>
            <Save className="h-4 w-4" /> Save
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={() => run("analyze", async () => { if (dirty) await api.put(`/stories/${story.id}`, draft); onChange(await api.post<Story>(`/stories/${story.id}/analyze`)); }, "Story analysed")}>
            {busy === "analyze" ? <><Spinner /> Analysing…</> : <><Sparkles className="h-4 w-4" /> {story.requirements.length ? "Re-analyse" : "Analyse with Claude"}</>}
          </button>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        {busy === "analyze" && !story.requirements.length ? (
          <div className="card flex items-center gap-3 p-6 text-sm text-slate-600"><Spinner className="h-5 w-5 text-brand-600" /> Claude is reading the story, extracting every testable rule and reviewing it for gaps…</div>
        ) : !story.requirements.length ? (
          <Empty icon={<ListChecks className="h-6 w-6" />} title="Not analysed yet" action={<button className="btn-primary" onClick={analyze}><Sparkles className="h-4 w-4" /> Analyse with Claude</button>}>
            Claude turns the story into a numbered requirements checklist and reviews it for contradictions, ambiguities, gaps and typos.
          </Empty>
        ) : (
          <>
            <section className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-500" /> Story review <span className="text-sm font-normal text-slate-500">· {story.review.length} finding(s)</span></h3>
                  <p className="text-sm text-slate-500">Problems in the story itself — resolve them before they become bugs.</p>
                </div>
                {story.review.length > 0 && <button className="btn-secondary" onClick={copyQuestions}><ClipboardCopy className="h-4 w-4" /> Copy questions for PO</button>}
              </div>
              <div className="mt-4 grid gap-3">
                {sortedReview.map((f, i) => <ReviewCard key={i} f={f} />)}
                {!story.review.length && <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> No problems found in the story.</p>}
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold text-slate-900"><ListChecks className="h-4 w-4 text-brand-600" /> Requirements <span className="text-sm font-normal text-slate-500">· {story.requirements.length - uncovered.length}/{story.requirements.length} covered by test cases</span></h3>
                  <p className="text-sm text-slate-500">Analysed {timeAgo(story.analyzed_at)}. Every rule should be covered by at least one test case check.</p>
                </div>
                {uncovered.length > 0 && (
                  <button className="btn-primary" onClick={() => onGenerate(`Cover these uncovered requirements: ${uncovered.map((r) => r.id).join(", ")}`)}>
                    <Wand2 className="h-4 w-4" /> Cover {uncovered.length} gap(s)
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {sections.map(([section, reqs]) => {
                  const covered = reqs.filter((r) => cov.get(r.id)?.length).length;
                  const open = openSections.has(section) || sections.length <= 2;
                  return (
                    <div key={section}>
                      <button className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-slate-50" onClick={() => { const n = new Set(openSections); if (n.has(section)) n.delete(section); else n.add(section); setOpenSections(n); }}>
                        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        <span className="flex-1 font-medium text-slate-900">{section}</span>
                        <span className={`text-xs tabular-nums ${covered === reqs.length ? "text-emerald-600" : "text-amber-600"}`}>{covered}/{reqs.length} covered</span>
                      </button>
                      {open && (
                        <ul className="space-y-1 px-6 pb-4">
                          {reqs.map((r) => {
                            const tcs = cov.get(r.id) ?? [];
                            return (
                              <li key={r.id} className="flex gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                                <span className="w-12 shrink-0 font-mono text-xs leading-5 text-slate-400">{r.id}</span>
                                <span className="min-w-0 flex-1 text-slate-700">{r.text}</span>
                                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                                  {tcs.length ? tcs.slice(0, 4).map((c) => <span key={c} className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700">{c}</span>) : <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">not covered</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
