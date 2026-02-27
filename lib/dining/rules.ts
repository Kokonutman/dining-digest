import { ItemHistoryMap, InterestingRecord, MenuRecord } from "@/lib/dining/types";
import { DINING_LIKED_ITEMS } from "@/data/dining-liked-items";

type InterestingConfig = {
  includeKeywords: string[];
  threshold: number;
  noveltyDays: number;
};

type EvaluateResult = {
  interesting: InterestingRecord[];
  warnings: string[];
};

const DEFAULT_INCLUDE_KEYWORDS = [...DINING_LIKED_ITEMS];

function parseCsvList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parsed = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toDayNumber(isoDate: string): number {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 86_400_000);
}

function itemKey(item: string): string {
  return item.trim().toLowerCase();
}

export function getInterestingConfig(): InterestingConfig {
  const threshold = parsePositiveInt(process.env.DINING_SCORE_THRESHOLD, 2);
  const noveltyDays = parsePositiveInt(process.env.DINING_NOVELTY_DAYS, 14);

  return {
    includeKeywords: parseCsvList(process.env.DINING_INCLUDE_KEYWORDS, DEFAULT_INCLUDE_KEYWORDS),
    threshold,
    noveltyDays
  };
}

export function evaluateInterestingItems(params: {
  records: MenuRecord[];
  history: ItemHistoryMap | null;
  date: string;
  config?: InterestingConfig;
}): EvaluateResult {
  const warnings: string[] = [];
  const config = params.config ?? getInterestingConfig();
  const nowDay = toDayNumber(params.date);

  const interesting: InterestingRecord[] = [];

  for (const record of params.records) {
    const normalizedItem = itemKey(record.item);
    if (!normalizedItem) continue;

    const matchedIncludes = config.includeKeywords.filter((keyword) =>
      normalizedItem.includes(keyword)
    );
    const matchedExcludes: string[] = [];

    let score = matchedIncludes.length;
    const hasSpecialTag = (record.tags ?? []).some((tag) => tag.toLowerCase() === "special");
    if (hasSpecialTag) {
      score += 2;
      matchedIncludes.push("special");
    }
    const blocked = false;

    const historyEntry = params.history?.[normalizedItem];
    let novelty = false;
    if (params.history) {
      if (!historyEntry?.lastSeen) {
        novelty = true;
      } else {
        const previousDay = toDayNumber(historyEntry.lastSeen);
        const daysSinceSeen = nowDay - previousDay;
        novelty = Number.isFinite(daysSinceSeen) && daysSinceSeen >= config.noveltyDays;
      }
    } else {
      warnings.push("STATE_DISABLED_NO_NOVELTY");
    }

    const isInteresting = hasSpecialTag || score >= config.threshold || novelty;
    if (!isInteresting) {
      continue;
    }

    interesting.push({
      ...record,
      key: normalizedItem,
      score,
      matchedIncludes,
      matchedExcludes,
      novelty,
      blocked
    });
  }

  return {
    interesting,
    warnings: Array.from(new Set(warnings))
  };
}

export function updateHistory(params: {
  records: MenuRecord[];
  existingHistory: ItemHistoryMap | null;
  date: string;
}): ItemHistoryMap | null {
  if (!params.existingHistory) {
    return null;
  }

  const next: ItemHistoryMap = { ...params.existingHistory };
  for (const record of params.records) {
    const key = itemKey(record.item);
    if (!key) continue;

    const current = next[key];
    next[key] = {
      lastSeen: params.date,
      count: (current?.count ?? 0) + 1
    };
  }

  return next;
}
