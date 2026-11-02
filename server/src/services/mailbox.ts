import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decrypt } from "../crypto";
import { getSettings } from "../settings";

export interface Email {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
}

export class MailboxError extends Error {}

function client() {
  const { mailbox } = getSettings();
  const pass = decrypt(mailbox.passEnc);
  if (!mailbox.host || !mailbox.user || !pass) throw new MailboxError("No test inbox configured (Settings → Test inbox). Emails such as OTP codes cannot be read.");
  return new ImapFlow({ host: mailbox.host, port: mailbox.port, secure: mailbox.secure, auth: { user: mailbox.user, pass }, logger: false });
}

async function fetchRecent(since: Date, hint: string): Promise<Email | null> {
  const imap = client();
  await imap.connect();
  const lock = await imap.getMailboxLock("INBOX");
  try {
    // IMAP SINCE has day granularity; filter precisely on the parsed date below.
    const day = new Date(since.getTime() - 24 * 3600_000);
    const uids = ((await imap.search({ since: day }, { uid: true })) || []).slice(-25).reverse();
    const words = hint.toLowerCase().split(/\s+/).filter(Boolean);
    for (const uid of uids) {
      const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const mail = await simpleParser(msg.source);
      const date = mail.date ?? new Date(0);
      if (date.getTime() < since.getTime() - 60_000) continue;
      const text = (mail.text || (typeof mail.html === "string" ? mail.html.replace(/<[^>]+>/g, " ") : "")).replace(/\s+\n/g, "\n").trim();
      const haystack = `${mail.subject ?? ""}\n${text}`.toLowerCase();
      if (words.length && !words.some((w) => haystack.includes(w))) continue;
      const addr = (a: unknown) => (a && typeof a === "object" && "text" in a ? String((a as { text: string }).text) : "");
      return { subject: mail.subject ?? "", from: addr(mail.from), to: addr(mail.to), date: date.toISOString(), text: text.slice(0, 6000) };
    }
    return null;
  } finally {
    lock.release();
    await imap.logout().catch(() => {});
  }
}

/** Wait up to `timeoutMs` for an email received after `since` that mentions any word of `hint`. */
export async function waitForEmail(since: Date, hint = "", timeoutMs = 90_000): Promise<Email> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = await fetchRecent(since, hint);
    if (mail) return mail;
    if (Date.now() > deadline) throw new MailboxError(`No email matching "${hint}" arrived within ${Math.round(timeoutMs / 1000)}s.`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export async function testMailbox() {
  const imap = client();
  await imap.connect();
  const status = await imap.status("INBOX", { messages: true });
  await imap.logout();
  return `Connected. Inbox has ${(status && status.messages) ?? 0} messages.`;
}
