import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axe from "axe-core";
import type { Page } from "playwright";
import { aiJson } from "../ai/claude";
import { VISUAL_SYSTEM } from "../ai/prompts";
import { VisualReview } from "../ai/schemas";
import type { PageState } from "./page-state";

export interface FrontendFinding {
  fingerprint: string;
  source: "accessibility-scan" | "layout-scan" | "visual-review";
  category: "frontend" | "accessibility" | "content";
  severity: "critical" | "major" | "minor" | "trivial";
  title: string;
  description: string;
  expected: string;
  url: string;
  screenshotPath: string | null;
}

const fp = (...parts: string[]) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.hash;
  } catch {
    return url;
  }
};

/** Identifies a distinct screen: URL path + main heading + visible form fields. */
export function screenSignature(state: PageState): string {
  const fields = state.elements.filter((e) => e.inViewport && ["textbox", "combobox", "checkbox", "radio", "button"].includes(e.role)).map((e) => e.name).slice(0, 25);
  const heading = state.text.split("\n").find((l) => l.trim().length > 2)?.trim() ?? "";
  return fp(pathOf(state.url), heading.slice(0, 80), fields.join(","));
}

// Runs in the page; plain source so bundler helpers never leak into the browser.
const LAYOUT_SCRIPT = `(() => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const css = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      const sib = e.parentElement ? Array.from(e.parentElement.children).filter((c) => c.tagName === e.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(s);
      if (e.id) { parts[0] = '#' + CSS.escape(e.id); break; }
    }
    return parts.join(' > ');
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('alt') || el.getAttribute('placeholder') || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60);

  const docWidth = document.documentElement.scrollWidth;
  if (docWidth > vw + 2) {
    let widest = null, max = vw;
    for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.right > max + 1 && visible(el)) { max = r.right; widest = el; } }
    out.push({ rule: 'horizontal-overflow', title: 'Page scrolls horizontally', detail: 'Content is ' + docWidth + 'px wide in a ' + vw + 'px viewport' + (widest ? '; widest element: ' + css(widest) + ' "' + label(widest) + '"' : ''), selector: widest ? css(widest) : null, severity: 'major' });
  }
  for (const img of document.querySelectorAll('img')) {
    if (visible(img) && img.complete && img.naturalWidth === 0) out.push({ rule: 'broken-image', title: 'Broken image', detail: 'Image failed to load: ' + (img.currentSrc || img.src).slice(0, 150), selector: css(img), severity: 'major' });
  }
  for (const el of document.querySelectorAll('p, span, label, h1, h2, h3, h4, button, a, li, td, div')) {
    if (!visible(el) || el.children.length > 0 || !(el.textContent || '').trim()) continue;
    const s = getComputedStyle(el);
    if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2) {
      out.push({ rule: 'clipped-text', title: 'Text is cut off', detail: '"' + label(el) + '" is clipped (' + el.scrollWidth + 'px content in ' + el.clientWidth + 'px)', selector: css(el), severity: 'minor' });
    }
  }
  const interactive = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio]')).filter(visible);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (touch) {
    const small = interactive.filter((el) => { const r = el.getBoundingClientRect(); const inline = el.tagName === 'A' && el.closest('p, li'); return !inline && (r.width < 24 || r.height < 24); });
    if (small.length) out.push({ rule: 'target-size', title: small.length + ' tap target(s) smaller than 24x24px', detail: small.slice(0, 5).map((el) => '"' + label(el) + '" ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height)).join(', '), selector: css(small[0]), severity: 'minor' });
  }
  for (let i = 0; i < interactive.length && i < 150; i++) {
    for (let j = i + 1; j < interactive.length && j < 150; j++) {
      const a = interactive[i], b = interactive[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 0 || h <= 0) continue;
      const overlap = (w * h) / Math.min(ra.width * ra.height, rb.width * rb.height);
      if (overlap > 0.3) out.push({ rule: 'overlap', title: 'Overlapping controls', detail: '"' + label(a) + '" overlaps "' + label(b) + '"', selector: css(a), severity: 'major' });
    }
  }
  return out.slice(0, 20);
})()`;

const AXE_RUN = `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
  .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 5).map((n) => ({ target: String(n.target[0]), html: n.html.slice(0, 160), summary: (n.failureSummary || '').slice(0, 300) })), count: v.nodes.length })))`;

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  description: string;
  helpUrl: string;
  nodes: { target: string; html: string; summary: string }[];
  count: number;
}

async function boxShot(page: Page, file: string, locate: () => Promise<{ x: number; y: number; width: number; height: number } | null>) {
  try {
    const box = await locate();
    if (box) {
      await page.evaluate(
        `(() => { const b = ${JSON.stringify(box)}; const d = document.createElement('div'); d.id='__qa_fe'; Object.assign(d.style, { position: 'absolute', left: (b.x + scrollX - 4) + 'px', top: (b.y + scrollY - 4) + 'px', width: (b.width + 8) + 'px', height: (b.height + 8) + 'px', border: '3px solid #ef4444', borderRadius: '6px', boxShadow: '0 0 0 4px rgba(239,68,68,.25)', zIndex: 2147483647, pointerEvents: 'none' }); document.body.appendChild(d); })()`,
      );
    }
    await page.screenshot({ path: file, type: "png" });
    await page.evaluate(`document.getElementById('__qa_fe')?.remove()`).catch(() => {});
    return file;
  } catch {
    return null;
  }
}

async function locateSelector(page: Page, selector: string | null) {
  if (!selector) return null;
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  return loc.boundingBox({ timeout: 2000 }).catch(() => null);
}

async function locateText(page: Page, text: string | null) {
  if (!text) return null;
  const loc = page.getByText(text.slice(0, 80), { exact: false }).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  return loc.boundingBox({ timeout: 2000 }).catch(() => null);
}

export interface AuditorOptions {
  enabled: boolean;
  maxVisualReviews: number;
  device: string;
  storyText: string;
  requirementsText: string;
  dir: string;
  onFindings: (findings: FrontendFinding[]) => void;
  log: (msg: string) => void;
}

/** Shared across all tests of a run so every distinct screen is audited once. */
export class FrontendAuditor {
  private seen = new Set<string>();
  private reported = new Set<string>();
  private visualReviews = 0;
  private counter = 0;

  constructor(private opts: AuditorOptions) {
    fs.mkdirSync(opts.dir, { recursive: true });
  }

  async audit(page: Page, state: PageState) {
    if (!this.opts.enabled) return;
    const signature = screenSignature(state);
    if (this.seen.has(signature)) return;
    this.seen.add(signature);
    const url = state.url;
    const where = pathOf(url);
    const findings: FrontendFinding[] = [];
    const shot = () => path.join(this.opts.dir, `fe-${++this.counter}.png`);
    const add = (f: Omit<FrontendFinding, "screenshotPath">, screenshotPath: string | null) => {
      if (this.reported.has(f.fingerprint)) return;
      this.reported.add(f.fingerprint);
      findings.push({ ...f, screenshotPath });
    };

    // 1. Accessibility (axe-core, WCAG 2.2 AA)
    try {
      await page.addScriptTag({ content: axe.source });
      const violations = (await page.evaluate(AXE_RUN)) as AxeViolation[];
      for (const v of violations.filter((x) => x.impact === "critical" || x.impact === "serious")) {
        const file = await boxShot(page, shot(), () => locateSelector(page, v.nodes[0]?.target ?? null));
        add(
          {
            fingerprint: fp("axe", v.id, where),
            source: "accessibility-scan",
            category: "accessibility",
            severity: v.impact === "critical" ? "major" : "minor",
            title: `Accessibility: ${v.help} (${v.count} element${v.count > 1 ? "s" : ""}) on ${where}`,
            description: `${v.description}\n\nAffected:\n${v.nodes.map((n) => `- ${n.target}: ${n.html}\n  ${n.summary.replace(/\n/g, " ")}`).join("\n")}\n\nRule: ${v.id} — ${v.helpUrl}`,
            expected: "Meets WCAG 2.2 AA",
            url,
          },
          file,
        );
      }
    } catch (e) {
      this.opts.log(`Accessibility scan skipped on ${where}: ${(e as Error).message.split("\n")[0]}`);
    }

    // 2. Layout heuristics
    let layout: { rule: string; title: string; detail: string; selector: string | null; severity: FrontendFinding["severity"] }[] = [];
    try {
      layout = (await page.evaluate(LAYOUT_SCRIPT)) as typeof layout;
      for (const l of layout) {
        const file = await boxShot(page, shot(), () => locateSelector(page, l.selector));
        add(
          { fingerprint: fp("layout", l.rule, where, l.rule === "overlap" || l.rule === "clipped-text" ? l.detail : ""), source: "layout-scan", category: "frontend", severity: l.severity, title: `${l.title} on ${where}`, description: l.detail, expected: "No layout defects", url },
          file,
        );
      }
    } catch (e) {
      this.opts.log(`Layout scan skipped on ${where}: ${(e as Error).message.split("\n")[0]}`);
    }

    // 3. Claude visual review against the story
    if (this.visualReviews < this.opts.maxVisualReviews) {
      this.visualReviews++;
      const full = path.join(this.opts.dir, `screen-${this.visualReviews}.jpg`);
      try {
        const height = (await page.evaluate("document.documentElement.scrollHeight")) as number;
        const vp = page.viewportSize() ?? { width: 1280, height: 720 };
        await page.screenshot({ path: full, type: "jpeg", quality: 75, fullPage: height < 5000, ...(height >= 5000 ? { clip: { x: 0, y: 0, width: vp.width, height: 5000 } } : {}) });
        const review = await aiJson({
          system: VISUAL_SYSTEM,
          prompt: [
            `DEVICE / VIEWPORT: ${this.opts.device} (${vp.width}x${vp.height})`,
            `URL: ${url}`,
            `STORY:\n${this.opts.storyText.slice(0, 6000)}`,
            this.opts.requirementsText ? `REQUIREMENTS:\n${this.opts.requirementsText.slice(0, 8000)}` : "",
            `AUTOMATED FINDINGS ALREADY REPORTED (do not repeat):\n${[...findings.map((f) => f.title), ...layout.map((l) => l.title)].join("\n") || "(none)"}`,
            `VISIBLE TEXT:\n${state.text.slice(0, 3000)}`,
            "Review this screen.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          images: [full],
          schema: VisualReview,
          effort: "medium",
          maxTokens: 8000,
        });
        for (const issue of review.issues) {
          const file = issue.element_text ? await boxShot(page, shot(), () => locateText(page, issue.element_text)) : full;
          add(
            {
              fingerprint: fp("ai", issue.category, where, issue.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
              source: "visual-review",
              category: issue.category === "content_mismatch" ? "content" : issue.category === "accessibility" ? "accessibility" : "frontend",
              severity: issue.severity,
              title: `${issue.title} (${where})`,
              description: `${issue.description}${issue.element_text ? `\n\nElement: "${issue.element_text}"` : ""}\nCategory: ${issue.category}\nDevice: ${this.opts.device}`,
              expected: issue.expected,
              url,
            },
            file,
          );
        }
      } catch (e) {
        this.opts.log(`Visual review skipped on ${where}: ${(e as Error).message.split("\n")[0]}`);
      }
    }

    if (findings.length) this.opts.onFindings(findings);
  }
}
