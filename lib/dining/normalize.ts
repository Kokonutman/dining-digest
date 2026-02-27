import { MenuRecord } from "@/lib/dining/types";

type NormalizeResult = {
  records: MenuRecord[];
  warnings: string[];
};

function normalizeText(input: string | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTag(tag: string): string {
  return normalizeText(tag).toLowerCase();
}

export function normalizeMenuRecords(input: MenuRecord[]): NormalizeResult {
  const warnings: string[] = [];
  const dedupe = new Map<string, MenuRecord>();

  for (const record of input) {
    const date = normalizeText(record.date);
    const hall = normalizeText(record.hall);
    const meal = normalizeText(record.meal);
    const station = normalizeText(record.station);
    const item = normalizeText(record.item);

    if (!date || !hall || !item) {
      warnings.push("NORMALIZE_SKIPPED_MISSING_REQUIRED_FIELD");
      continue;
    }

    const tags = (record.tags ?? []).map(normalizeTag).filter(Boolean);
    const normalized: MenuRecord = {
      date,
      hall,
      meal: meal || "Unknown Meal",
      station: station || undefined,
      item,
      tags: tags.length ? Array.from(new Set(tags)) : undefined,
      raw: record.raw
    };

    const key = [
      normalized.date.toLowerCase(),
      normalized.hall.toLowerCase(),
      normalized.meal.toLowerCase(),
      (normalized.station ?? "").toLowerCase(),
      normalized.item.toLowerCase()
    ].join("|");

    if (!dedupe.has(key)) {
      dedupe.set(key, normalized);
    }
  }

  return {
    records: [...dedupe.values()],
    warnings
  };
}
