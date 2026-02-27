import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendDigestEmail } from "@/lib/dining/email";
import { fetchDiningMenus } from "@/lib/dining/fetch";
import { groupInterestingItems } from "@/lib/dining/group";
import { normalizeMenuRecords } from "@/lib/dining/normalize";
import {
  getDigestHashForDate,
  getItemHistory,
  getLastRunAt,
  setDigestHashForDate,
  setItemHistory,
  setLastRunAt
} from "@/lib/dining/state";
import { evaluateInterestingItems, updateHistory } from "@/lib/dining/rules";

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
  const candidates = [process.env.DINING_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (!candidates.length) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 && candidates.includes(token);
}

function computeDigestHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function GET(request: NextRequest) {
  const start = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        metadata: {
          timestamp: new Date().toISOString(),
          dateProcessed: null,
          durationMs: Date.now() - start
        },
        stats: {
          hallsCount: 0,
          totalRecords: 0,
          interestingCount: 0
        },
        interestingItems: [],
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
  const force = params.get("force") === "1";

  const requestedDate = params.get("date") ?? todayInTimeZoneIso();
  const date = isValidIsoDate(requestedDate) ? requestedDate : todayInTimeZoneIso();
  if (!isValidIsoDate(requestedDate)) {
    warnings.push("INVALID_DATE_OVERRIDE_USING_TODAY");
  }

  const lastRunRes = await getLastRunAt();
  warnings.push(...lastRunRes.warnings);
  if (!force && lastRunRes.value) {
    const lastRunMs = Date.parse(lastRunRes.value);
    if (!Number.isNaN(lastRunMs)) {
      const elapsed = Date.now() - lastRunMs;
      if (elapsed < 5 * 60 * 1000) {
        return NextResponse.json(
          {
            metadata: {
              timestamp: new Date().toISOString(),
              dateProcessed: date,
              durationMs: Date.now() - start
            },
            stats: {
              hallsCount: 0,
              totalRecords: 0,
              interestingCount: 0
            },
            interestingItems: [],
            emailSent: false,
            warnings: [...warnings, "RECENT_RUN_LOCK"],
            errors
          },
          { status: 429 }
        );
      }
    }
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
  const hallsCount = new Set(normalizeResult.records.map((record) => record.hall.toLowerCase())).size;

  let emailSent = false;

  if (!normalizeResult.records.length) {
    warnings.push("UPSTREAM_EMPTY_NO_EMAIL_SENT");
  }

  const digestHash = computeDigestHash(grouped);
  const digestRes = await getDigestHashForDate(date);
  warnings.push(...digestRes.warnings);

  const isDuplicateDigest = digestRes.value !== null && digestRes.value === digestHash;
  if (isDuplicateDigest) {
    warnings.push("DIGEST_UNCHANGED_NO_EMAIL");
  }

  const shouldTryEmail =
    !dryRun && normalizeResult.records.length > 0 && grouped.length > 0 && !isDuplicateDigest;

  if (shouldTryEmail) {
    const emailResult = await sendDigestEmail({
      date,
      generatedAtIso: new Date().toISOString(),
      items: grouped,
      dryRun
    });
    warnings.push(...emailResult.warnings);
    errors.push(...emailResult.errors);
    emailSent = emailResult.emailSent;
  } else if (dryRun) {
    warnings.push("DRY_RUN_NO_EMAIL");
  }

  const historyUpdate = updateHistory({
    records: normalizeResult.records,
    existingHistory: historyRes.value,
    date
  });

  warnings.push(...(await setLastRunAt(new Date().toISOString())));

  if (historyUpdate) {
    warnings.push(...(await setItemHistory(historyUpdate)));
  }

  if (emailSent) {
    warnings.push(...(await setDigestHashForDate(date, digestHash)));
  }

  const durationMs = Date.now() - start;
  const responseBody = {
    metadata: {
      timestamp: new Date().toISOString(),
      dateProcessed: date,
      durationMs
    },
    stats: {
      hallsCount,
      totalRecords: normalizeResult.records.length,
      interestingCount: grouped.length
    },
    interestingItems: grouped,
    emailSent,
    warnings: Array.from(new Set(warnings)),
    errors: Array.from(new Set(errors)),
    ...(debug
      ? {
          debug: {
            dryRun,
            force,
            rawRecordCount: fetchResult.records.length,
            normalizedRecords: normalizeResult.records
          }
        }
      : {})
  };

  console.info("[dining.run.summary]", {
    date,
    totalRecords: normalizeResult.records.length,
    interestingCount: grouped.length,
    emailSent,
    warnings: Array.from(new Set(warnings)).length,
    errors: Array.from(new Set(errors)).length
  });

  const statusCode = errors.length ? 207 : 200;
  return NextResponse.json(responseBody, { status: statusCode });
}
