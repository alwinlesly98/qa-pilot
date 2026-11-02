import { z } from "zod";

// Every field is required (nullable where optional) so the same schema works with
// API structured outputs and with JSON validation in Claude Code CLI mode.

// ---------------------------------------------------------------- story analysis

export const Requirement = z.object({
  id: z.string().describe("R-01, R-02, … in story order"),
  section: z.string().describe("Page or step of the flow, e.g. 'Your details', 'Delivery'"),
  text: z.string().describe("One atomic, testable rule, quoting exact UI copy and validation messages"),
  kind: z.enum(["field", "validation", "navigation", "content", "behavior", "email", "admin", "other"]),
  priority: z.enum(["high", "medium", "low"]),
});

export const ReviewFinding = z.object({
  kind: z.enum(["contradiction", "ambiguity", "gap", "typo", "risk"]),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  detail: z.string().describe("What is wrong or unclear, and why it matters for build/test"),
  quote: z.string().describe("The exact story text concerned; empty if it is a gap"),
  suggestion: z.string().describe("A concrete question for the product owner or a proposed fix"),
});

export const StoryAnalysis = z.object({
  requirements: z.array(Requirement),
  review: z.array(ReviewFinding),
});
export type StoryAnalysis = z.infer<typeof StoryAnalysis>;

// ---------------------------------------------------------------- test cases

export const Check = z.object({
  id: z.string().describe("C1, C2, … unique within the test case"),
  text: z.string().describe("One observable expectation, quoting exact copy where the story gives it"),
  requirement_ids: z.array(z.string()),
});
export type Check = z.infer<typeof Check>;

const AUTOMATION = z.enum(["auto", "partial", "manual"]).describe(
  "auto: fully executable in a browser; partial: some checks need email/admin/device access; manual: cannot be automated in a browser",
);

export const GeneratedTestCase = z.object({
  title: z.string().describe("Short, specific test scenario"),
  type: z.string().describe("Team's test type, e.g. Sanity, Regression, Integration, Negative, UI"),
  priority: z.enum(["high", "medium", "low"]),
  preconditions: z.string().describe("State required before the steps; empty string if none"),
  requires_login: z.boolean().describe("true only when the test must start signed in"),
  steps: z.array(z.string()).describe("Concrete, executable UI steps"),
  test_data: z.string().describe("Inputs to use, e.g. 'First name: 51 x A; Email: test@'"),
  expected_result: z.string(),
  checks: z.array(Check),
  requirement_ids: z.array(z.string()),
  automation: AUTOMATION,
});
export type GeneratedTestCase = z.infer<typeof GeneratedTestCase>;

export const TestCaseList = z.object({ test_cases: z.array(GeneratedTestCase) });

export const CheckExpansion = z.object({
  items: z.array(
    z.object({
      index: z.number().int().describe("Index of the test case in the input list"),
      checks: z.array(Check),
      requirement_ids: z.array(z.string()),
      requires_login: z.boolean(),
      automation: AUTOMATION,
    }),
  ),
});

export const ColumnMapping = z.object({
  header_row: z.number().int().describe("0-based index of the header row"),
  code: z.number().int().nullable(),
  title: z.number().int().nullable(),
  preconditions: z.number().int().nullable(),
  steps: z.number().int().nullable(),
  test_data: z.number().int().nullable(),
  expected: z.number().int().nullable(),
  type: z.number().int().nullable(),
  owner: z.number().int().nullable(),
  remarks: z.number().int().nullable(),
  result_columns: z.array(z.number().int()).describe("Columns that hold per-build/platform pass-fail results"),
});
export type ColumnMapping = z.infer<typeof ColumnMapping>;

// ---------------------------------------------------------------- repo analysis

export const AppContext = z.object({
  summary: z.string().describe("What the application does, in 2-4 sentences"),
  tech_stack: z.string(),
  pages: z.array(
    z.object({
      route: z.string(),
      purpose: z.string(),
      key_elements: z.string().describe("Forms, fields, buttons, test ids or labels found in code"),
    }),
  ),
  auth: z.string().describe("How login works, if visible in code; empty if unknown"),
  testing_notes: z.string().describe("Anything that helps a tester: validation rules, roles, feature flags"),
});
export type AppContext = z.infer<typeof AppContext>;

// ---------------------------------------------------------------- browser agent

export const ACTION_TYPES = [
  "navigate", "click", "fill", "select", "press", "hover", "check", "uncheck", "scroll", "wait", "back",
  "upload", "draw", "read_email", "verify", "finish",
] as const;

export const ASSERTION_KINDS = [
  "text_visible", "text_not_visible", "url_contains", "field_value", "element_visible", "element_hidden",
  "element_enabled", "element_disabled", "element_checked", "element_count", "none",
] as const;

const IssueDraft = z.object({
  check_id: z.string().nullable().describe("The check this defect breaks, if any"),
  category: z.enum(["functional", "validation", "content", "navigation", "frontend"]),
  title: z.string(),
  actual: z.string(),
  expected: z.string().describe("Per the story / test case, quoting exact copy"),
  severity: z.enum(["critical", "major", "minor", "trivial"]),
  steps_to_reproduce: z.array(z.string()),
  comment: z.string().describe("Tester comment for the developer: what is wrong and where to look"),
  element_ref: z.number().int().nullable().describe("Ref of the element where the defect is visible, if any"),
});
export type IssueDraft = z.infer<typeof IssueDraft>;

export const AgentDecision = z.object({
  thought: z.string().describe("One or two sentences: what you see and why you take this action"),
  current_step: z.number().int().describe("1-based index of the test case step being worked on"),
  action: z.object({
    type: z.enum(ACTION_TYPES),
    ref: z.number().int().nullable().describe("Element ref from the element list, for element actions"),
    value: z
      .string()
      .nullable()
      .describe(
        "fill: text (may contain {{VARIABLES}}); select: option label; press: key; navigate: URL or path; scroll: up|down; wait: ms; upload: number of photos; read_email: words to find the email (e.g. 'code')",
      ),
    description: z.string().describe('Human readable, e.g. Click the "Continue" button'),
  }),
  verification: z
    .object({
      check_id: z.string().nullable().describe("Which check (C1, C2…) this verifies"),
      expectation: z.string(),
      passed: z.boolean(),
      observation: z.string().describe("What is actually on the screen, quoting exact text"),
      assertion: z.object({
        kind: z.enum(ASSERTION_KINDS).describe("How a Playwright script should assert this"),
        ref: z.number().int().nullable(),
        text: z.string().nullable().describe("Expected text / URL part / value / count"),
      }),
    })
    .nullable()
    .describe("Required when action.type is verify, otherwise null"),
  finish: z
    .object({
      status: z.enum(["passed", "failed", "blocked"]),
      summary: z.string(),
      issues: z.array(IssueDraft).describe("One entry per distinct defect; empty unless status is failed"),
      not_verified: z
        .array(z.object({ check_id: z.string(), reason: z.string() }))
        .describe("Checks that could not be executed (e.g. needs admin panel or device camera)"),
    })
    .nullable()
    .describe("Required when action.type is finish, otherwise null"),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

export const VisualReview = z.object({
  issues: z.array(
    z.object({
      title: z.string(),
      category: z.enum(["layout", "typography", "content_mismatch", "visual", "responsive", "accessibility", "usability"]),
      severity: z.enum(["critical", "major", "minor", "trivial"]),
      description: z.string(),
      expected: z.string().describe("What the story or standard UI practice requires"),
      element_text: z.string().nullable().describe("Exact visible text of/near the affected element, to locate it"),
    }),
  ),
});
export type VisualReview = z.infer<typeof VisualReview>;

export const RunSummary = z.object({
  verdict: z.enum(["ready", "ready_with_risks", "not_ready"]),
  headline: z.string(),
  highlights: z.array(z.string()),
  risks: z.array(z.string()),
});
export type RunSummary = z.infer<typeof RunSummary>;

// ---------------------------------------------------------------- Playwright code

export const SpecCode = z.object({
  code: z.string().describe("Complete TypeScript file content"),
  notes: z.string().describe("Anything the reviewer should know (assumptions, manual parts)"),
});
