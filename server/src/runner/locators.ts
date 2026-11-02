import type { Locator, Page } from "playwright";
import type { ElementInfo } from "./page-state";

const q = (s: string) => JSON.stringify(s);
const ROLES = new Set(["button", "link", "textbox", "checkbox", "radio", "combobox", "tab", "menuitem", "option", "switch", "searchbox", "slider", "spinbutton"]);
type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * The most readable Playwright locator that matches exactly one element, as code for
 * generated specs. Candidates are tried in Playwright's recommended order.
 */
export async function bestLocator(page: Page, el: ElementInfo | null): Promise<string | null> {
  if (!el) return null;
  const candidates: [string, () => Locator][] = [];
  if (el.testId) candidates.push([`page.getByTestId(${q(el.testId)})`, () => page.getByTestId(el.testId!)]);
  if (ROLES.has(el.role) && el.name) {
    candidates.push([`page.getByRole(${q(el.role)}, { name: ${q(el.name)}, exact: true })`, () => page.getByRole(el.role as AriaRole, { name: el.name, exact: true })]);
  }
  if (["textbox", "combobox", "checkbox", "radio", "searchbox", "spinbutton"].includes(el.role) && el.name) {
    candidates.push([`page.getByLabel(${q(el.name)}, { exact: true })`, () => page.getByLabel(el.name, { exact: true })]);
  }
  if (el.placeholder) candidates.push([`page.getByPlaceholder(${q(el.placeholder)}, { exact: true })`, () => page.getByPlaceholder(el.placeholder!, { exact: true })]);
  if (el.name && !["textbox", "combobox"].includes(el.role)) candidates.push([`page.getByText(${q(el.name)}, { exact: true })`, () => page.getByText(el.name, { exact: true })]);
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) candidates.push([`page.locator(${q("#" + el.id)})`, () => page.locator(`#${el.id}`)]);

  for (const [code, make] of candidates) {
    try {
      if ((await make().count()) === 1) return code;
    } catch {
      /* try next */
    }
  }
  // Ambiguous everywhere: pin by position among same-role/name matches.
  if (ROLES.has(el.role) && el.name) {
    try {
      const all = page.getByRole(el.role as AriaRole, { name: el.name, exact: true });
      const n = await all.count();
      for (let i = 0; i < n; i++) {
        if ((await all.nth(i).getAttribute("data-qa-ref")) === String(el.ref)) return `page.getByRole(${q(el.role)}, { name: ${q(el.name)}, exact: true }).nth(${i})`;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}
