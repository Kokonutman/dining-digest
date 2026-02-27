import { GroupedInterestingItem, InterestingRecord } from "@/lib/dining/types";

export function groupInterestingItems(records: InterestingRecord[]): GroupedInterestingItem[] {
  const groups = new Map<string, GroupedInterestingItem>();

  for (const record of records) {
    const existing = groups.get(record.key);
    if (!existing) {
      groups.set(record.key, {
        item: record.item,
        key: record.key,
        score: record.score,
        novelty: record.novelty,
        matchedIncludes: [...record.matchedIncludes],
        matchedExcludes: [...record.matchedExcludes],
        appearances: [
          {
            hall: record.hall,
            meal: record.meal,
            station: record.station
          }
        ]
      });
      continue;
    }

    existing.score = Math.max(existing.score, record.score);
    existing.novelty = existing.novelty || record.novelty;
    existing.matchedIncludes = Array.from(
      new Set([...existing.matchedIncludes, ...record.matchedIncludes])
    );
    existing.matchedExcludes = Array.from(
      new Set([...existing.matchedExcludes, ...record.matchedExcludes])
    );

    const appearanceKey = `${record.hall}|${record.meal}|${record.station ?? ""}`.toLowerCase();
    const hasAppearance = existing.appearances.some(
      (appearance) =>
        `${appearance.hall}|${appearance.meal}|${appearance.station ?? ""}`.toLowerCase() ===
        appearanceKey
    );
    if (!hasAppearance) {
      existing.appearances.push({
        hall: record.hall,
        meal: record.meal,
        station: record.station
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      appearances: group.appearances.sort((a, b) => {
        const hallCmp = a.hall.localeCompare(b.hall);
        if (hallCmp !== 0) return hallCmp;
        const mealCmp = a.meal.localeCompare(b.meal);
        if (mealCmp !== 0) return mealCmp;
        return (a.station ?? "").localeCompare(b.station ?? "");
      })
    }))
    .sort((a, b) => {
      const scoreCmp = b.score - a.score;
      if (scoreCmp !== 0) return scoreCmp;
      return a.item.localeCompare(b.item);
    });
}
