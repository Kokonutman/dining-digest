import { MenuRecord } from "@/lib/dining/types";

type DiningLocation = {
  id: string;
  hall: string;
};

type FetchDiningMenusResult = {
  records: MenuRecord[];
  warnings: string[];
  errors: string[];
};

const DEFAULT_BASE_URL = "https://nutrition.umd.edu";
const DEFAULT_SPECIALS_URL = "https://dining.umd.edu/terrapin-favorites";
const DEFAULT_LOCATIONS: DiningLocation[] = [
  { id: "16", hall: "South Campus" },
  { id: "19", hall: "Yahentamitsi Dining Hall" },
  { id: "51", hall: "251 North" }
];
const DEFAULT_MEALS = ["Breakfast", "Lunch", "Dinner", "Brunch"];

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number.parseInt(num, 10);
      if (Number.isNaN(code)) return _;
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (Number.isNaN(code)) return _;
      return String.fromCodePoint(code);
    });
}

function formatDateForUmd(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  return `${month}/${day}/${year}`;
}

function parseCsvList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parts = value
    .split(",")
    .map((part) => cleanText(part))
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function getBaseUrl() {
  const fromEnv = process.env.DINING_SOURCE_BASE_URL;
  return (fromEnv && fromEnv.trim()) || DEFAULT_BASE_URL;
}

async function fetchLocations(baseUrl: string, warnings: string[]): Promise<DiningLocation[]> {
  try {
    const response = await fetch(`${baseUrl}/`, {
      cache: "no-store"
    });

    if (!response.ok) {
      warnings.push(`LOCATIONS_FETCH_HTTP_${response.status}`);
      return DEFAULT_LOCATIONS;
    }

    const html = await response.text();
    const selectMatch = html.match(
      /<select[^>]*id=["']location-select-menu["'][^>]*>([\s\S]*?)<\/select>/i
    );

    if (!selectMatch?.[1]) {
      warnings.push("LOCATIONS_SELECT_NOT_FOUND");
      return DEFAULT_LOCATIONS;
    }

    const options = [...selectMatch[1].matchAll(/<option\s+value=['"]?(\d+)['"]?>([\s\S]*?)<\/option>/gi)];
    if (!options.length) {
      warnings.push("LOCATIONS_OPTIONS_EMPTY");
      return DEFAULT_LOCATIONS;
    }

    const parsed = options
      .map((match) => ({
        id: cleanText(match[1]),
        hall: cleanText(stripTags(match[2]))
      }))
      .filter((entry) => entry.id && entry.hall);

    return parsed.length ? parsed : DEFAULT_LOCATIONS;
  } catch {
    warnings.push("LOCATIONS_FETCH_FAILED");
    return DEFAULT_LOCATIONS;
  }
}

function parseLongMenuHtml(params: {
  html: string;
  date: string;
  hall: string;
  meal: string;
  warnings: string[];
}): MenuRecord[] {
  const { html, date, hall, meal, warnings } = params;
  const records: MenuRecord[] = [];

  const tableMatch = html.match(/<table[^>]*id=["']long-menu-table["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch?.[1]) {
    if (/No\s+Data\s+Available/i.test(html)) {
      return records;
    }
    warnings.push(`MISSING_MENU_TABLE:${hall}:${meal}`);
    return records;
  }

  const tableHtml = tableMatch[1];
  const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  let currentStation: string | undefined;

  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    const firstTdMatch = rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!firstTdMatch?.[1]) {
      continue;
    }

    const cellHtml = firstTdMatch[1];
    if (/Station\s*\/\s*Item\s*Name/i.test(cellHtml)) {
      continue;
    }

    const stationMatch = cellHtml.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (stationMatch?.[1]) {
      const station = cleanText(stripTags(stationMatch[1]));
      currentStation = station || undefined;
      continue;
    }

    const itemMatch = cellHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (!itemMatch?.[1]) {
      continue;
    }

    const item = cleanText(stripTags(itemMatch[1]));
    if (!item) {
      continue;
    }

    const tagMatches = [...rowHtml.matchAll(/\b(?:alt|title)\s*=\s*['"]([^'"]+)['"]/gi)];
    const tags = tagMatches
      .map((match) => cleanText(match[1]))
      .filter(Boolean);

    records.push({
      date,
      hall,
      meal,
      station: currentStation,
      item,
      tags: tags.length ? Array.from(new Set(tags)) : undefined,
      raw: undefined
    });
  }

  return records;
}

function toMonthDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return "";
  return `${month}/${day}`;
}

function parseSpecialStation(blockHtml: string): string | undefined {
  const startsMatch = blockHtml.match(/starts\\s*[^<]*?[\\u2013\\u2014\\-\\uFFFD]\\s*([^<]+)/i);
  if (!startsMatch?.[1]) return undefined;
  const parsed = cleanText(stripTags(startsMatch[1]));
  return parsed || undefined;
}

function parseTerrapinFavoritesHtml(params: {
  html: string;
  date: string;
  warnings: string[];
}): MenuRecord[] {
  const { html, date, warnings } = params;
  const targetMonthDay = toMonthDay(date);
  if (!targetMonthDay) {
    warnings.push("SPECIALS_INVALID_DATE");
    return [];
  }

  const paneMatches = [
    ...html.matchAll(
      /<div\s+class="tab-pane[^>]*"\s+id="tabs-2351-pane-(?:16|17|18)"[^>]*>([\s\S]*?)<\/div>/gi
    )
  ];

  if (!paneMatches.length) {
    warnings.push("SPECIALS_PANES_NOT_FOUND");
    return [];
  }

  const records: MenuRecord[] = [];
  for (const paneMatch of paneMatches) {
    const paneHtml = paneMatch[1];
    const hallMatch = paneHtml.match(/<h2>([\s\S]*?)<\/h2>/i);
    const hall = cleanText(stripTags(hallMatch?.[1] ?? ""));
    if (!hall) continue;

    const dayBlocks = [...paneHtml.matchAll(/<h6>\s*<strong>([\s\S]*?)<\/strong>\s*<\/h6>([\s\S]*?)(?=<h6>|$)/gi)];
    for (const dayBlock of dayBlocks) {
      const heading = cleanText(stripTags(dayBlock[1]));
      const body = dayBlock[2];
      const mdMatch = heading.match(/(\d{1,2})\/(\d{1,2})/);
      if (!mdMatch) continue;
      const monthDay = `${Number.parseInt(mdMatch[1], 10)}/${Number.parseInt(mdMatch[2], 10)}`;
      if (monthDay !== targetMonthDay) continue;

      const specialMatches = [...body.matchAll(/<h3>([\s\S]*?)<\/h3>/gi)];
      for (const specialMatch of specialMatches) {
        const item = cleanText(stripTags(specialMatch[1]));
        if (!item || item === "---" || item === "--*--") continue;
        records.push({
          date,
          hall,
          meal: "Specials",
          station: parseSpecialStation(body),
          item,
          tags: ["special"],
          raw: undefined
        });
      }
    }
  }

  return records;
}

async function fetchTerrapinFavorites(date: string, warnings: string[], errors: string[]): Promise<MenuRecord[]> {
  const url = process.env.DINING_SPECIALS_URL?.trim() || DEFAULT_SPECIALS_URL;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      warnings.push(`SPECIALS_HTTP_${response.status}`);
      return [];
    }

    const html = await response.text();
    const records = parseTerrapinFavoritesHtml({ html, date, warnings });
    if (!records.length) {
      warnings.push("SPECIALS_EMPTY_FOR_DATE");
    }
    return records;
  } catch {
    errors.push("SPECIALS_FETCH_FAILED");
    return [];
  }
}

function findArraysRecursively(input: unknown, depth = 0): unknown[][] {
  if (depth > 3) return [];
  if (Array.isArray(input)) {
    return [input, ...input.flatMap((entry) => findArraysRecursively(entry, depth + 1))];
  }
  if (input && typeof input === "object") {
    return Object.values(input).flatMap((value) => findArraysRecursively(value, depth + 1));
  }
  return [];
}

function toStringOrEmpty(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number") return cleanText(String(value));
  return "";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringOrEmpty(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => cleanText(part))
      .filter(Boolean);
  }
  return [];
}

function extractRecordsFromJsonPayload(payload: unknown, date: string): MenuRecord[] {
  const arrays = findArraysRecursively(payload);
  const records: MenuRecord[] = [];

  for (const arr of arrays) {
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;

      const item = toStringOrEmpty(obj.item ?? obj.itemName ?? obj.menuItem ?? obj.name ?? obj.title);
      if (!item) continue;

      const hall = toStringOrEmpty(
        obj.hall ?? obj.location ?? obj.locationName ?? obj.diningHall ?? obj.dining_hall
      );
      const meal = toStringOrEmpty(obj.meal ?? obj.mealName ?? obj.service ?? obj.period);
      const station = toStringOrEmpty(obj.station ?? obj.stationName ?? obj.category);

      const tags = toStringArray(obj.tags ?? obj.allergens ?? obj.attributes);
      records.push({
        date,
        hall: hall || "Unknown Hall",
        meal: meal || "Unknown Meal",
        station: station || undefined,
        item,
        tags: tags.length ? tags : undefined,
        raw: undefined
      });
    }
  }

  return records;
}

async function tryJsonEndpoint(
  date: string,
  warnings: string[],
  errors: string[]
): Promise<MenuRecord[] | null> {
  const endpoint = process.env.DINING_JSON_ENDPOINT?.trim();
  if (!endpoint) return null;

  try {
    const hasQuery = endpoint.includes("?");
    const url = `${endpoint}${hasQuery ? "&" : "?"}date=${encodeURIComponent(date)}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      warnings.push(`JSON_ENDPOINT_HTTP_${response.status}`);
      return null;
    }

    const payload = (await response.json()) as unknown;
    const records = extractRecordsFromJsonPayload(payload, date);
    if (!records.length) {
      warnings.push("JSON_ENDPOINT_EMPTY_OR_UNRECOGNIZED");
      return null;
    }
    warnings.push("JSON_ENDPOINT_USED");
    return records;
  } catch {
    errors.push("JSON_ENDPOINT_FETCH_FAILED");
    return null;
  }
}

export async function fetchDiningMenus(date: string): Promise<FetchDiningMenusResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const jsonRecords = await tryJsonEndpoint(date, warnings, errors);
  if (jsonRecords && jsonRecords.length) {
    const specials = await fetchTerrapinFavorites(date, warnings, errors);
    return {
      records: [...jsonRecords, ...specials],
      warnings,
      errors
    };
  }

  const baseUrl = getBaseUrl();
  const locations = await fetchLocations(baseUrl, warnings);
  const meals = parseCsvList(process.env.DINING_MEALS, DEFAULT_MEALS);
  const dtdate = formatDateForUmd(date);

  const records: MenuRecord[] = [];

  for (const location of locations) {
    for (const meal of meals) {
      const url = `${baseUrl}/longmenu.aspx?dtdate=${encodeURIComponent(dtdate)}&locationNum=${encodeURIComponent(location.id)}&mealName=${encodeURIComponent(meal)}`;

      try {
        const response = await fetch(url, {
          cache: "no-store"
        });

        if (!response.ok) {
          warnings.push(`LONGMENU_HTTP_${response.status}:${location.hall}:${meal}`);
          continue;
        }

        const html = await response.text();
        const parsed = parseLongMenuHtml({
          html,
          date,
          hall: location.hall,
          meal,
          warnings
        });
        records.push(...parsed);
      } catch {
        errors.push(`LONGMENU_FETCH_FAILED:${location.hall}:${meal}`);
      }
    }
  }

  const specials = await fetchTerrapinFavorites(date, warnings, errors);
  records.push(...specials);

  if (!records.length) {
    warnings.push("NO_RECORDS_FETCHED");
  }

  return {
    records,
    warnings,
    errors
  };
}
