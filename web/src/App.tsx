import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { FolderKanban, LayoutDashboard, Plus, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { api } from "./lib/api";
import type { Project } from "./lib/types";
import Dashboard from "./pages/Dashboard";
import ProjectPage from "./pages/Project";
import ProjectNew from "./pages/ProjectNew";
import StoryPage from "./pages/Story";
import RunView from "./pages/RunView";
import IssueEditor from "./pages/IssueEditor";
import Settings from "./pages/Settings";

export const PROJECTS_CHANGED = "qa:projects-changed";

function Sidebar() {
  const [projects, setProjects] = useState<Project[]>([]);
  const location = useLocation();
  useEffect(() => {
    const load = () => api.get<Project[]>("/projects").then(setProjects).catch(() => {});
    load();
    window.addEventListener(PROJECTS_CHANGED, load);
    return () => window.removeEventListener(PROJECTS_CHANGED, load);
  }, [location.pathname]);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? "bg-white/10 text-white shadow-inner" : "text-slate-400 hover:bg-white/5 hover:text-white"}`;

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-white/5 bg-slate-950 px-3 py-5 md:flex">
      <div className="mb-8 flex items-center gap-3 px-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-600/30">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">QA Pilot</div>
          <div className="text-[11px] text-slate-500">Claude × Playwright</div>
        </div>
      </div>
      <nav className="space-y-1">
        <NavLink to="/" end className={link}>
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </NavLink>
        <NavLink to="/settings" className={link}>
          <SettingsIcon className="h-4 w-4" /> Settings
        </NavLink>
      </nav>
      <div className="mb-2 mt-8 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Projects
        <NavLink to="/projects/new" className="rounded-md p-1 hover:bg-white/10 hover:text-white" title="New project">
          <Plus className="h-3.5 w-3.5" />
        </NavLink>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {projects.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.id}`} className={link}>
            <FolderKanban className="h-4 w-4 shrink-0" />
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {!projects.length && <p className="px-3 text-xs text-slate-600">No projects yet</p>}
      </nav>
      <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
        Story → requirements → test cases → AI run → Playwright suite → Jira.
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="md:pl-64">
        <div className="mx-auto max-w-[1500px] px-4 py-7 md:px-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/projects/new" element={<ProjectNew />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/projects/:pid/stories/:sid" element={<StoryPage />} />
            <Route path="/runs/:id" element={<RunView />} />
            <Route path="/issues/:id" element={<IssueEditor />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
