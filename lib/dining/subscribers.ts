import { createHmac, timingSafeEqual } from "node:crypto";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getUnsubscribeSecret(): string | null {
  const candidate =
    process.env.DINING_UNSUBSCRIBE_SECRET ||
    process.env.DINING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    null;
  return candidate?.trim() || null;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(input: string): boolean {
  return EMAIL_REGEX.test(normalizeEmail(input));
}

export function makeUnsubscribeToken(email: string): string | null {
  const secret = getUnsubscribeSecret();
  if (!secret) return null;
  const normalized = normalizeEmail(email);
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = makeUnsubscribeToken(email);
  if (!expected) return false;
  const provided = token.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function getPublicBaseUrl(): string | null {
  const fromEnv = process.env.DINING_PUBLIC_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) {
    return `https://${productionHost}`.replace(/\/+$/, "");
  }

  const host = process.env.VERCEL_URL?.trim();
  if (host) {
    return `https://${host}`.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  return null;
}
