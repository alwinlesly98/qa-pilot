import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import ProjectForm from "../components/ProjectForm";
import { useToast } from "../components/ui";
import { PROJECTS_CHANGED } from "../App";

export default function ProjectNew() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New project</h1>
        <p className="text-sm text-slate-500">Everything QA Pilot needs to test your application.</p>
      </div>
      <ProjectForm
        submitLabel="Create project"
        onSubmit={async (v) => {
          try {
            const p = await api.post<Project>("/projects", v);
            window.dispatchEvent(new Event(PROJECTS_CHANGED));
            navigate(`/projects/${p.id}`);
          } catch (e) {
            toast("error", (e as Error).message);
          }
        }}
      />
    </div>
  );
}
