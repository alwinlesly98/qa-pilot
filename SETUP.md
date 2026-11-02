# QA Pilot — Setup guide

How to install QA Pilot on a computer, connect it to Claude and Jira, and get the first test run working.
Allow about 20 minutes for a new machine.

---

## 1. What each computer needs

| Item | Version / notes |
|---|---|
| Operating system | Windows 10/11, macOS, or Linux |
| **Node.js** | **22 or newer** (LTS recommended) — https://nodejs.org. With nvm: `nvm install lts` |
| Git | Only needed for "Analyse repository" — https://git-scm.com |
| Disk space | 3 GB free to install; run videos and screenshots add more over time |
| Internet | To download packages and the Chromium browser, and to reach Claude / Jira |
| Claude access | A Claude **Pro / Max / Team** subscription (through Claude Code) **or** an Anthropic API key |

Check Node in a terminal: `node -v` → must print `v22…` or higher.
On Windows, `start.bat` also finds a newer Node installed with nvm even if your default is older.

---

## 2. Get QA Pilot onto the new computer

Pick one:

**A. Zip from an existing install (simplest)**
On the computer that already has QA Pilot:
```bat
npm run bundle
```
This creates `qa-pilot-YYYY-MM-DD.zip` in the project folder (code only, a few MB). Copy it to the new computer and unzip it, e.g. to `C:\QA Pilot`.

**B. Git**
Put the project in a Git repository once (`git init`, commit, push to GitHub/GitLab), then on the new computer: `git clone <repo-url>`.
The `.gitignore` already excludes `node_modules`, `data` and `.env`.

> Do **not** copy `node_modules` between computers — it is rebuilt by the installer.

---

## 3. Install and start

**Windows:** double-click **`start.bat`** in the project folder.
**macOS / Linux:** run `./start.sh` in a terminal.

The first start:
1. creates `.env` from `.env.example`,
2. installs the packages (`npm install`, a few minutes),
3. downloads the Chromium browser used for testing,
4. builds the UI and starts the server,
5. opens **http://localhost:4300**.

Keep the window open while you use QA Pilot. Close it (or press `Ctrl+C`) to stop.
Every later start skips the install steps and takes a few seconds.

---

## 4. Connect Claude (Settings → Claude)

Choose **one**:

### Option 1 — Claude subscription (Pro / Max / Team)
1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
   (or use the VS Code / Cursor "Claude Code" extension — QA Pilot finds its bundled copy automatically).
2. Sign in once: run `claude` in a terminal and complete the browser login (or `claude login`).
3. In QA Pilot → **Settings → Claude**: select **Claude subscription**. The field "Claude CLI command" shows **Using: …** in green when Claude Code was found.
4. Click **Test Claude connection** → you should see a greeting.

### Option 2 — Anthropic API key
1. Create a key at https://console.anthropic.com (billed per use).
2. In **Settings → Claude**: select **Anthropic API key**, paste the key, **Save**, **Test Claude connection**.

Recommended for a shared/team server or CI. Model: **Claude Opus 5.5** (most accurate) is the default; Sonnet 5.5 is faster and cheaper.

---

## 5. Connect Jira (Settings → Jira)

**Jira Cloud** (`yourcompany.atlassian.net`)
1. Create an API token: https://id.atlassian.com → Security → **Create and manage API tokens**.
2. Settings → Jira: type **Jira Cloud**, Base URL `https://yourcompany.atlassian.net`, your Atlassian **email**, the **API token**.
3. **Save** → **Test Jira connection** → "Connected as …".

**Jira Server / Data Center**: type **Server**, Base URL, and a **personal access token** (Profile → Personal Access Tokens).

Your Jira user needs permission to create issues and assign them in the project.

---

## 6. Test inbox for OTP and email checks (Settings → Test inbox) — recommended

Needed when the site sends a one-time code by email (e.g. the VeriChain *Your details* step) and for test cases that check email content.

1. Use a dedicated mailbox, e.g. `qa-inbox@yourcompany.com` (Gmail works: enable 2-step verification and create an **App Password**).
2. Settings → Test inbox: host (`imap.gmail.com`), port `993`, TLS **Yes**, username, password / app password → **Test inbox connection**.
3. In each project add a test-data variable `TEST_EMAIL` = that address (or a `+alias`, e.g. `qa-inbox+verichain@…`), and use `{{TEST_EMAIL}}` in test steps.

Alternative: if staging accepts a fixed code, add a secret variable `OTP` = that code.

---

## 7. Set up a project (per application)

**Dashboard → New project**:

| Section | What to enter |
|---|---|
| Application | Name, **Site URL** of the environment to test (staging), default device |
| Customer login | Login page URL, username, password — for test cases that start signed in |
| **Test data** | Values test cases use as `{{NAME}}`. Typical: `TEST_EMAIL`, `EXISTING_EMAIL`, `OTP` (secret), `ADMIN_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (secret), and sample data such as certificate numbers (`VALID_CERT=VC-BC-10428`, `INVALID_CERT=VC-BC-99999`) |
| Source code (optional) | Git URL, branch, access token → then **Settings tab → Analyse repository** |
| Jira | The Jira project new bugs go to |

The site under test must be running and reachable from this computer when you run tests.

---

## 8. First run — checklist

1. **Project → Stories → New user story** → paste the story exactly as written → **Create & analyse**. Review *Story review* findings and **Copy questions for PO**.
2. **Test cases → Import sheet** → paste the Google Sheets link of the right tab (sheet shared as *Anyone with the link can view*), or upload `.xlsx`, or paste cells. Check the column mapping → **Import**. Claude derives the checks.
3. Open a few test cases, confirm steps/checks look right, set **Starts signed in / guest**, mark ones that cannot be automated as `manual`.
4. **Run tests** → choose device → watch the live run.
5. Review **Issues** (functional, content, front-end, accessibility) → edit / annotate → **Send to Jira**.
6. **Run → Generate Playwright** → **Playwright** tab → **Run all specs** → **Playwright report**.
7. **Export Excel** → choose the result column (e.g. `Web- V1.1`).

---

## 9. Move existing projects to another computer

On the old computer:
```bat
npm run bundle -- --with-data
```
The zip also contains `data/qa-pilot.db` (projects, stories, test cases, settings) and **`data/secret.key`** (needed to read saved passwords and tokens). Run videos and screenshots are not included.
Unzip on the new computer and run `start.bat`.

> The `--with-data` zip contains your saved secrets — share it only with people allowed to see them.
> Without `secret.key`, saved passwords/tokens cannot be decrypted; re-enter them in Settings and project settings.

**Backups:** copy the `data` folder (at least `qa-pilot.db` and `secret.key`) regularly.

---

## 10. Share with your team on the office network (optional)

One computer runs QA Pilot; others use it in their browser.

1. In `.env` set `HOST=0.0.0.0` and restart `start.bat`.
2. Allow inbound TCP port **4300** in Windows Defender Firewall (when Windows asks, allow private networks).
3. Teammates open `http://<that-computer's-IP>:4300` (find the IP with `ipconfig`).

QA Pilot has **no login of its own** — only do this on a trusted network or behind your VPN. For a team server, use an **Anthropic API key** rather than a personal subscription.

---

## 11. Update to a newer version

1. Stop QA Pilot.
2. Replace the code (unzip the new bundle over the folder, or `git pull`) — **keep the `data` folder and `.env`**.
3. Delete `node_modules` if the update notes say dependencies changed, then run `start.bat` (it reinstalls automatically).
   The database is upgraded automatically on start.

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `'claude' is not recognized` / "Claude Code was not found" | Install Claude Code (`npm install -g @anthropic-ai/claude-code`) and sign in with `claude`, or enter its full path in Settings → Claude, or use an API key |
| Claude Code error "not logged in" | Run `claude` in a terminal and complete the login |
| "QA Pilot needs Node.js 22 or newer" | Install Node LTS from nodejs.org (or `nvm install lts`), run `start.bat` again |
| Page shows *ERR_CONNECTION_REFUSED* | The server is not running — start `start.bat` and keep its window open |
| Port 4300 already in use | Another QA Pilot is running, or set `PORT=4301` in `.env` |
| Google Sheet import: "Could not read the sheet" | Share → General access → *Anyone with the link* (Viewer), or File → Download → .xlsx and upload |
| Test case IDs come in as TC-001 instead of yours | Check the column mapping in the import preview (set *Test case no.* to your ID column) |
| Tests are **blocked** at the OTP step | Configure the Test inbox (section 6) or an `OTP` variable |
| "Variable {{X}} is not defined" | Add it under Project → Settings → Test data |
| Jira 401 / 403 | Wrong email/token, or the user lacks create/assign permission in that project |
| Jira "priority" or "assignee" errors | The project's create screen lacks that field — leave it empty or ask your Jira admin |
| Disk full / slow | Delete old runs (trash icon on a run removes its videos and screenshots); turn off *Record video* in Settings |
| Chromium missing after copying the folder | Run `npx playwright install chromium` (start.bat does this automatically) |
| Linux: browser fails to launch | `npx playwright install-deps chromium` |
