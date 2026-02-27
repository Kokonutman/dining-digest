import { NextRequest, NextResponse } from "next/server";
import { sendDigestEmail } from "@/lib/dining/email";
import { fetchDiningMenus } from "@/lib/dining/fetch";
import { groupInterestingItems } from "@/lib/dining/group";
import { normalizeMenuRecords } from "@/lib/dining/normalize";
import { getItemHistory } from "@/lib/dining/state";
import { evaluateInterestingItems } from "@/lib/dining/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayInTimeZoneIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.DINING_TIMEZONE || "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DINING_TEST_EMAIL_SECRET?.trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 && token === secret;
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!process.env.DINING_TEST_EMAIL_SECRET?.trim()) {
    return NextResponse.json(
      {
        metadata: {
          timestamp: new Date().toISOString(),
          dateProcessed: null,
          durationMs: Date.now() - start
        },
        emailSent: false,
        warnings,
        errors: ["TEST_EMAIL_SECRET_NOT_CONFIGURED"]
      },
      { status: 503 }
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        metadata: {
          timestamp: new Date().toISOString(),
          dateProcessed: null,
          durationMs: Date.now() - start
        },
        emailSent: false,
        warnings,
        errors: ["UNAUTHORIZED"]
      },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  const debug = params.get("debug") === "1";

  const requestedDate = params.get("date") ?? todayInTimeZoneIso();
  const date = isValidIsoDate(requestedDate) ? requestedDate : todayInTimeZoneIso();
  if (!isValidIsoDate(requestedDate)) {
    warnings.push("INVALID_DATE_OVERRIDE_USING_TODAY");
  }

  const fetchResult = await fetchDiningMenus(date);
  warnings.push(...fetchResult.warnings);
  errors.push(...fetchResult.errors);

  const normalizeResult = normalizeMenuRecords(fetchResult.records);
  warnings.push(...normalizeResult.warnings);

  const historyRes = await getItemHistory();
  warnings.push(...historyRes.warnings);

  const evaluated = evaluateInterestingItems({
    records: normalizeResult.records,
    history: historyRes.value,
    date
  });
  warnings.push(...evaluated.warnings);

  const grouped = groupInterestingItems(evaluated.interesting);
  if (!grouped.length) {
    warnings.push("NO_INTERESTING_ITEMS_TEST_EMAIL");
  }

  const emailResult = await sendDigestEmail({
    date,
    generatedAtIso: new Date().toISOString(),
    items: grouped,
    dryRun
  });
  warnings.push(...emailResult.warnings);
  errors.push(...emailResult.errors);

  return NextResponse.json(
    {
      metadata: {
        timestamp: new Date().toISOString(),
        dateProcessed: date,
        durationMs: Date.now() - start
      },
      stats: {
        totalRecords: normalizeResult.records.length,
        interestingCount: grouped.length
      },
      emailSent: emailResult.emailSent,
      provider: emailResult.provider,
      warnings: Array.from(new Set(warnings)),
      errors: Array.from(new Set(errors)),
      ...(debug
        ? {
            debug: {
              dryRun,
              rawRecordCount: fetchResult.records.length,
              normalizedRecords: normalizeResult.records,
              interestingItems: grouped
            }
          }
        : {})
    },
    { status: errors.length ? 207 : 200 }
  );
}
