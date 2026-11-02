# QA Pilot — AI test automation (Claude + Playwright + Jira)

User story → Claude writes test cases → Claude drives a real browser with Playwright → live visual run → report → reviewed, annotated defects → Jira, assigned to the right person.

> **Installing on a new computer, connecting Claude/Jira/test inbox, moving data or sharing with the team: see [SETUP.md](SETUP.md).**

## Quick start (Windows)

```bat
start.bat          :: installs on first run, builds the UI, opens http://localhost:4300
start.bat dev      :: development mode with hot reload (UI on http://localhost:5173)
```

Requires Node 22+ (the launcher automatically picks the newest Node 22+ installed with nvm — install one with `nvm install lts`) and Git (for repo analysis).

### Connect Claude (Settings → Claude)

| Option | Setup | Best for |
|---|---|---|
| **Claude subscription** (default) | `npm i -g @anthropic-ai/claude-code` then `claude login` with your Pro/Max/Team account | Individual testers on their own machine |
| **Anthropic API key** | Paste a key from console.anthropic.com | Shared server, CI, higher throughput |

Default model: **Claude Opus 5.5** (most accurate). Sonnet 5.5 is faster/cheaper for large suites.

### Connect Jira (Settings → Jira)
Jira Cloud: base URL + account email + API token (id.atlassian.com → Security → API tokens).
Jira Server/Data Center: base URL + personal access token.

### Test inbox (Settings → Test inbox) — optional
An IMAP mailbox that receives the app's emails (OTP codes, confirmations). Claude reads it during a run with the `read_email` action. Gmail: `imap.gmail.com` + an App Password.

## Workflow

1. **Project** — site URL, customer login (encrypted; Claude only types `{{USERNAME}}`/`{{PASSWORD}}`), **Test data** variables such as `{{OTP}}`, `{{EXISTING_EMAIL}}`, `{{ADMIN_URL}}` (secrets are encrypted and hidden from Claude), Git URL + token, Jira project, default device.
2. **User story** — paste the story exactly as the team wrote it. Claude produces:
   - a numbered **requirements checklist** (every field, limit, default, exact validation message, show/hide rule, navigation, email and admin effect), grouped by page;
   - a **story review**: contradictions, ambiguities, gaps and typos in the story itself, with a "Copy questions for PO" button;
   - **coverage**: which test cases cover each requirement, and a button to generate cases for the gaps.
3. **Test cases** — a table laid out like the team's sheet:
   - **Import sheet**: Google Sheets link (shared "anyone with the link"), `.xlsx`/`.csv` upload, or pasted cells. IDs (`TC_01`), wording, Test Type, QA and the per-build result columns (`Web- V1.1` …) are kept; columns are auto-detected and adjustable.
   - Claude **derives checks** for each scenario — one exact, verifiable expectation each (every message, limit, default) — linked to requirements.
   - Or **Generate with Claude**, or paste any format.
4. **Build** — the developer registers a build (version, branch/commit, deployed URL), or CI posts it to the webhook, which can auto-run the suite.
5. **Run** — pick build, device (desktop, iPhone, Pixel, iPad emulation) and tests. Watch the browser live with Claude's reasoning.
   - Every check gets its own pass/fail with the observed text; a test can raise several defects.
   - The agent can type boundary values, upload photos, draw signatures and read OTP emails.
   - **Front-end review** on every new screen: WCAG 2.2 AA scan (axe-core), layout scan (horizontal scroll, broken images, clipped text, overlapping or too-small tap targets) and a Claude visual review against the story's copy.
   - Signs in once and reuses the session; failures are re-run to confirm (pass-on-retry = **flaky**). Outcomes: passed / failed / blocked / flaky.
   - Evidence: screenshot per step, highlighted defect screenshots, video, Playwright trace.
6. **Playwright** — "Generate Playwright" turns AI runs into real `.spec.ts` files (role/label/test-id locators recorded during the run, `expect` assertions from the story). Each spec is run immediately; script errors are auto-repaired, assertions are never weakened. Run the suite on any device with Playwright's **official HTML report**, or **Download suite** (zip with config, helpers, sample photos, `.env.example`) for your repo/CI.
7. **Reports** — AI release-readiness verdict, standalone HTML report (checks matrix + front-end section), and **Export Excel** in the team's own layout: the chosen result column (e.g. `Web- V1.1`) filled with Pass/Fail/Blocked, defects + Jira keys in Remarks, plus Defects and Coverage tabs.
8. **Issues** — drafts by category (functional, validation, content, front-end, accessibility) with highlighted screenshots and Claude's comment. Annotate (box/arrow/pen/note), edit anything, bulk approve / mark not-a-bug, pick Jira project, type, priority and assignee → **Send to Jira**. Screenshots are attached.

## Layout
```
server/  Express + SQLite + Playwright runner + Claude + Jira   (port 4300)
web/     React + Tailwind UI
data/    database, encryption key, run artifacts, cloned repos   (git-ignored)
```

## Scope notes
- Mobile = mobile **web** via Playwright device emulation on Chromium. Native Android/iOS apps need an Appium driver (not included).
- Checks needing an admin panel run when you add its URL and credentials as test data; otherwise they are reported as "not verified" with the reason. Live camera capture cannot be automated (photo upload can).
- Single-user/local by design (no login on QA Pilot itself). Put it behind your VPN/SSO before sharing on a network.

## Versions
Node 26 LTS · React 19 · React Router 7 · Tailwind CSS 4 · Vite 8 · TypeScript 7 · Express 5 · Playwright 1.64 · better-sqlite3 13 · Anthropic SDK 1.3 · Zod 4.

To update dependencies later: `npm outdated --workspaces`, then `npm install <pkg>@latest -w server` / `-w web`, then `npm run typecheck && npm run build`.
