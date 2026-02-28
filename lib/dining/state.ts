import { Redis } from "@upstash/redis";
import { ItemHistoryMap } from "@/lib/dining/types";

type StateResult<T> = {
  value: T;
  warnings: string[];
};

const KEY_LAST_RUN_AT = "dining:lastRunAt";
const KEY_ITEM_HISTORY = "dining:itemHistory";
const KEY_DIGEST_PREFIX = "dining:digest:";

let memoryLastRunAt: string | null = null;

function uniqueSubscribers(input: string[]): string[] {
  return Array.from(new Set(input.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function getRedisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return Redis.fromEnv();
}

function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ""),
    serviceRoleKey
  };
}

async function supabaseRequest(pathAndQuery: string, init: RequestInit): Promise<Response> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  return fetch(`${config.url}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

export async function getLastRunAt(): Promise<StateResult<string | null>> {
  const redis = getRedisClient();
  if (!redis) {
    return {
      value: memoryLastRunAt,
      warnings: ["STATE_DISABLED"]
    };
  }

  try {
    const value = await redis.get<string>(KEY_LAST_RUN_AT);
    return { value: value ?? null, warnings: [] };
  } catch {
    return { value: memoryLastRunAt, warnings: ["STATE_LAST_RUN_READ_FAILED"] };
  }
}

export async function setLastRunAt(timestampIso: string): Promise<string[]> {
  memoryLastRunAt = timestampIso;
  const redis = getRedisClient();
  if (!redis) {
    return ["STATE_DISABLED"];
  }

  try {
    await redis.set(KEY_LAST_RUN_AT, timestampIso);
    return [];
  } catch {
    return ["STATE_LAST_RUN_WRITE_FAILED"];
  }
}

export async function getItemHistory(): Promise<StateResult<ItemHistoryMap | null>> {
  const redis = getRedisClient();
  if (!redis) {
    return { value: null, warnings: ["STATE_DISABLED"] };
  }

  try {
    const value = await redis.get<ItemHistoryMap>(KEY_ITEM_HISTORY);
    return {
      value: value ?? {},
      warnings: []
    };
  } catch {
    return { value: null, warnings: ["STATE_HISTORY_READ_FAILED"] };
  }
}

export async function setItemHistory(history: ItemHistoryMap): Promise<string[]> {
  const redis = getRedisClient();
  if (!redis) {
    return ["STATE_DISABLED"];
  }

  try {
    await redis.set(KEY_ITEM_HISTORY, history);
    return [];
  } catch {
    return ["STATE_HISTORY_WRITE_FAILED"];
  }
}

export async function getDigestHashForDate(date: string): Promise<StateResult<string | null>> {
  const redis = getRedisClient();
  if (!redis) {
    return { value: null, warnings: ["STATE_DISABLED"] };
  }

  try {
    const value = await redis.get<string>(`${KEY_DIGEST_PREFIX}${date}`);
    return { value: value ?? null, warnings: [] };
  } catch {
    return { value: null, warnings: ["STATE_DIGEST_READ_FAILED"] };
  }
}

export async function setDigestHashForDate(date: string, digestHash: string): Promise<string[]> {
  const redis = getRedisClient();
  if (!redis) {
    return ["STATE_DISABLED"];
  }

  try {
    await redis.set(`${KEY_DIGEST_PREFIX}${date}`, digestHash);
    return [];
  } catch {
    return ["STATE_DIGEST_WRITE_FAILED"];
  }
}

export async function addMailingListSubscriber(email: string): Promise<StateResult<boolean>> {
  const normalized = email.trim().toLowerCase();
  if (!getSupabaseConfig()) {
    return { value: false, warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const existingResponse = await supabaseRequest(
      `dining_subscribers?select=email&email=eq.${encodeURIComponent(normalized)}`,
      { method: "GET", cache: "no-store" }
    );
    if (!existingResponse.ok) {
      return { value: false, warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const existing = ((await existingResponse.json()) as Array<{ email: string }>).map(
      (entry) => entry.email
    );
    const alreadyExists = existing.includes(normalized);
    if (!alreadyExists) {
      const insertResponse = await supabaseRequest("dining_subscribers", {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ email: normalized })
      });
      if (!insertResponse.ok) {
        return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
      }
    }

    return { value: !alreadyExists, warnings: [] };
  } catch {
    return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}

export async function getMailingListSubscribers(): Promise<StateResult<string[]>> {
  if (!getSupabaseConfig()) {
    return { value: [], warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const response = await supabaseRequest("dining_subscribers?select=email&order=created_at.asc", {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return { value: [], warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const existing = uniqueSubscribers(
      ((await response.json()) as Array<{ email: string }>).map((entry) => entry.email)
    );
    return { value: existing, warnings: [] };
  } catch {
    return { value: [], warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
  }
}

export async function removeMailingListSubscriber(email: string): Promise<StateResult<boolean>> {
  const normalized = email.trim().toLowerCase();
  if (!getSupabaseConfig()) {
    return { value: false, warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const existingResponse = await supabaseRequest(
      `dining_subscribers?select=email&email=eq.${encodeURIComponent(normalized)}`,
      { method: "GET", cache: "no-store" }
    );
    if (!existingResponse.ok) {
      return { value: false, warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const existing = ((await existingResponse.json()) as Array<{ email: string }>).map(
      (entry) => entry.email
    );
    const existed = existing.includes(normalized);
    if (existed) {
      const deleteResponse = await supabaseRequest(
        `dining_subscribers?email=eq.${encodeURIComponent(normalized)}`,
        {
          method: "DELETE",
          headers: {
            Prefer: "return=minimal"
          }
        }
      );
      if (!deleteResponse.ok) {
        return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
      }
    }

    return { value: existed, warnings: [] };
  } catch {
    return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}
