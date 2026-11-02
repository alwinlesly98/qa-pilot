import type { Page } from "playwright";

export interface ElementInfo {
  ref: number;
  tag: string;
  role: string;
  name: string;
  type: string | null;
  placeholder: string | null;
  value: string | null;
  checked: boolean | null;
  disabled: boolean;
  href: string | null;
  testId: string | null;
  id: string | null;
  inViewport: boolean;
}

export interface PageState {
  url: string;
  title: string;
  elements: ElementInfo[];
  text: string;
}

const MAX_ELEMENTS = 160;

/**
 * Tag every visible interactive element with data-qa-ref and describe it.
 * Runs inside the page; must be self-contained.
 */
function collect(max: number) {
  const SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]", "[role=menuitem]",
    "[role=option]", "[role=switch]", "[role=combobox]", "[role=textbox]", "[role=searchbox]", "[role=slider]",
    "[contenteditable=true]", "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  document.querySelectorAll("[data-qa-ref]").forEach((el) => el.removeAttribute("data-qa-ref"));

  const implicitRole = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return tag;
  };

  const clean = (s: string | null | undefined, n = 80) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

  const accessibleName = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (clean(t)) return clean(t);
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return clean(Array.from(labels).map((l) => l.innerText).join(" "));
    const text = clean(el.innerText);
    if (text) return text;
    return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || (el as HTMLInputElement).value || el.querySelector("img")?.getAttribute("alt"));
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const candidates: { el: HTMLElement; inViewport: boolean }[] = [];
  for (const node of Array.from(document.querySelectorAll(SELECTOR))) {
    const el = node as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 1 || rect.height < 1 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
      // Visually hidden native checkboxes/radios are usually styled via their label; keep them.
      if (!(el.tagName === "INPUT" && /checkbox|radio/.test((el as HTMLInputElement).type))) continue;
    }
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
    candidates.push({ el, inViewport });
  }
  // Prefer elements in the viewport, then document order.
  candidates.sort((a, b) => Number(b.inViewport) - Number(a.inViewport));

  return candidates.slice(0, max).map(({ el, inViewport }, i) => {
    el.setAttribute("data-qa-ref", String(i));
    const input = el as HTMLInputElement;
    const type = el.tagName === "INPUT" ? input.type : null;
    const isField = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    let value: string | null = null;
    if (isField) value = type === "password" ? (input.value ? "••••" : "") : el.tagName === "SELECT" ? clean((el as HTMLSelectElement).selectedOptions[0]?.text) : clean(input.value, 60);
    return {
      ref: i,
      tag: el.tagName.toLowerCase(),
      role: implicitRole(el),
      name: accessibleName(el),
      type,
      placeholder: el.getAttribute("placeholder"),
      value,
      checked: type === "checkbox" || type === "radio" ? input.checked : el.getAttribute("aria-checked") ? el.getAttribute("aria-checked") === "true" : null,
      disabled: input.disabled === true || el.getAttribute("aria-disabled") === "true",
      href: el.tagName === "A" ? (el.getAttribute("href") || "").slice(0, 100) : null,
      testId: el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy"),
      id: el.id || null,
      inViewport,
    };
  });
}

// tsx/esbuild wraps nested functions in __name(...) calls, which don't exist inside the browser;
// ship the collector as source with a local shim.
const COLLECT_SCRIPT = `(() => { const __name = (f) => f; return (${collect.toString()})(${MAX_ELEMENTS}); })()`;

export async function capturePageState(page: Page): Promise<PageState> {
  const elements = (await page.evaluate(COLLECT_SCRIPT).catch(() => [])) as ElementInfo[];
  const text = await page
    .evaluate(() => (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 4000))
    .catch(() => "");
  return { url: page.url(), title: await page.title().catch(() => ""), elements, text };
}

export function formatElements(elements: ElementInfo[]): string {
  if (!elements.length) return "(no interactive elements found)";
  return elements
    .map((e) => {
      const bits = [`[${e.ref}]`, e.role, e.name ? `"${e.name}"` : "(no name)"];
      if (e.type && !["text", "submit", "button"].includes(e.type)) bits.push(`type=${e.type}`);
      if (e.placeholder && e.placeholder !== e.name) bits.push(`placeholder="${e.placeholder}"`);
      if (e.value) bits.push(`value="${e.value}"`);
      if (e.checked !== null) bits.push(e.checked ? "checked" : "unchecked");
      if (e.disabled) bits.push("disabled");
      if (e.href) bits.push(`href=${e.href}`);
      if (!e.inViewport) bits.push("(off-screen)");
      return bits.join(" ");
    })
    .join("\n");
}

/** Draw a red box around an element (for defect screenshots). Returns false if not found. */
export async function highlight(page: Page, ref: number | null): Promise<boolean> {
  if (ref == null) return false;
  return page
    .evaluate((r) => {
      const el = document.querySelector(`[data-qa-ref="${r}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      const rect = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.id = "__qa_highlight";
      Object.assign(box.style, {
        position: "fixed", left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
        border: "3px solid #ef4444", borderRadius: "6px", boxShadow: "0 0 0 4px rgba(239,68,68,.25)", zIndex: "2147483647", pointerEvents: "none",
      });
      document.body.appendChild(box);
      return true;
    }, ref)
    .catch(() => false);
}

export async function clearHighlight(page: Page) {
  await page.evaluate(() => document.getElementById("__qa_highlight")?.remove()).catch(() => {});
}
