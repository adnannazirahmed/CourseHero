import crypto from "node:crypto";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function newId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID()}`;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
