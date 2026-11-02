import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

function loadKey(): Buffer {
  if (process.env.APP_SECRET && /^[0-9a-f]{64}$/i.test(process.env.APP_SECRET)) {
    return Buffer.from(process.env.APP_SECRET, "hex");
  }
  const file = path.join(DATA_DIR, "secret.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

const KEY = loadKey();

/** AES-256-GCM. Output: iv.tag.ciphertext (base64). */
export function encrypt(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const [iv, tag, data] = enc.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
