import { aiJson } from "../ai/claude";
import { ANALYSIS_SYSTEM, EXPAND_SYSTEM, IMPORT_SYSTEM, TESTCASE_SYSTEM } from "../ai/prompts";
import { CheckExpansion, GeneratedTestCase, StoryAnalysis, TestCaseList } from "../ai/schemas";
import { all, db, get, insert, now, Row, update } from "../db";
import { nextCodeFn } from "./sheets";
import { describeVariables } from "./variables";

export function storyBlock(story: Row) {
  return `USER STORY: ${story.title}\n\n${story.description || "(no description)"}\n\nACCEPTANCE CRITERIA:\n${story.acceptance_criteria || "(none given)"}`;
}

export function requirementsBlock(story: Row, ids?: string[]) {
  const reqs = ((story.requirements ?? []) as Row[]).filter((r) => !ids?.length || ids.includes(r.id));
  if (!reqs.length) return "";
  return reqs.map((r) => `${r.id} [${r.section}] ${r.text}`).join("\n");
}

function contextBlock(project: Row) {
  return project.app_context ? `APPLICATION CONTEXT (from the source code):\n${project.app_context}` : "";
}

/** Requirements checklist + review of the story's own problems (contradictions, gaps, typos…). */
export async function analyzeStory(project: Row, story: Row) {
  const result = await aiJson({
    system: ANALYSIS_SYSTEM,
    prompt: [`SITE: ${project.site_url}`, contextBlock(project), storyBlock(story), "Analyse this story."].filter(Boolean).join("\n\n"),
    schema: StoryAnalysis,
    effort: "high",
    maxTokens: 32000,
  });
  return update("stories", story.id, { requirements: result.requirements, review: result.review, analyzed_at: now() })!;
}

async function ensureAnalyzed(project: Row, story: Row) {
  return (story.requirements as Row[])?.length ? story : analyzeStory(project, story);
}

function save(project: Row, story: Row, cases: GeneratedTestCase[], source: "ai" | "manual") {
  const code = nextCodeFn(project.id);
  const base = (db.prepare("SELECT COALESCE(MAX(sort),0) m FROM test_cases WHERE story_id=?").get(story.id) as { m: number }).m;
  return db.transaction(() =>
    cases.map((tc, i) =>
      insert("test_cases", { ...tc, project_id: project.id, story_id: story.id, code: code(), source, enabled: true, sort: base + i + 1, created_at: now() }),
    ),
  )();
}

export async function generateTestCases(project: Row, story: Row, guidance?: string) {
  story = await ensureAnalyzed(project, story);
  const existing = all("SELECT code, title, requirement_ids FROM test_cases WHERE story_id=?", story.id);
  const prompt = [
    `SITE URL: ${project.site_url}`,
    contextBlock(project),
    storyBlock(story),
    `REQUIREMENTS:\n${requirementsBlock(story)}`,
    `TEST DATA VARIABLES:\n${describeVariables(project)}`,
    existing.length
      ? `EXISTING TEST CASES (do not duplicate; focus on uncovered requirements):\n${existing.map((r) => `- ${r.code} ${r.title} [${(r.requirement_ids as string[]).join(", ")}]`).join("\n")}`
      : "",
    guidance ? `EXTRA GUIDANCE FROM THE TESTER:\n${guidance}` : "",
    "Write the test cases.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await aiJson({ system: TESTCASE_SYSTEM, prompt, schema: TestCaseList, effort: "high", maxTokens: 64000 });
  return save(project, story, result.test_cases, "ai");
}

export async function importTestCases(project: Row, story: Row, text: string) {
  story = await ensureAnalyzed(project, story);
  const prompt = `${storyBlock(story)}\n\nREQUIREMENTS:\n${requirementsBlock(story)}\n\nTEST CASES WRITTEN BY THE TESTER:\n${text}\n\nConvert them.`;
  const result = await aiJson({ system: IMPORT_SYSTEM, prompt, schema: TestCaseList, effort: "medium", maxTokens: 64000 });
  return save(project, story, result.test_cases, "manual");
}

/** Derive concrete checks for high-level (e.g. spreadsheet) test cases so each expectation is verified on its own. */
export async function expandChecks(project: Row, story: Row, testCaseIds?: string[]) {
  story = await ensureAnalyzed(project, story);
  const cases = all("SELECT * FROM test_cases WHERE story_id=? ORDER BY sort, code", story.id).filter(
    (c) => (testCaseIds?.length ? testCaseIds.includes(c.id) : !(c.checks as Row[]).length),
  );
  if (!cases.length) return [];
  const list = cases
    .map((c, i) => `#${i} ${c.code} ${c.title}\nPreconditions: ${c.preconditions}\nSteps: ${(c.steps as string[]).join(" / ")}\nTest input: ${c.test_data}\nExpected: ${c.expected_result}`)
    .join("\n\n");
  const result = await aiJson({
    system: EXPAND_SYSTEM,
    prompt: `${storyBlock(story)}\n\nREQUIREMENTS:\n${requirementsBlock(story)}\n\nTEST CASES:\n${list}\n\nDerive the checks for each test case.`,
    schema: CheckExpansion,
    effort: "high",
    maxTokens: 64000,
  });
  return db.transaction(() =>
    result.items
      .filter((it) => cases[it.index])
      .map((it) => update("test_cases", cases[it.index].id, { checks: it.checks, requirement_ids: it.requirement_ids, requires_login: it.requires_login, automation: it.automation })!),
  )();
}

/** Coverage of each requirement by the story's test cases. */
export function coverage(storyId: string) {
  const story = get("stories", storyId)!;
  const cases = all("SELECT id, code, requirement_ids FROM test_cases WHERE story_id=?", storyId);
  return ((story.requirements ?? []) as Row[]).map((r) => ({ id: r.id, test_cases: cases.filter((c) => (c.requirement_ids as string[]).includes(r.id)).map((c) => c.code) }));
}
