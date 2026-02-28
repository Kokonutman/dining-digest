import { Redis } from "@upstash/redis";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
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

function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
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
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { value: false, warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const { data: existing, error: readError } = await supabase
      .from("dining_subscribers")
      .select("email")
      .eq("email", normalized)
      .limit(1);
    if (readError) {
      return { value: false, warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const alreadyExists = (existing ?? []).some((entry) => entry.email === normalized);
    if (!alreadyExists) {
      const { error: insertError } = await supabase
        .from("dining_subscribers")
        .insert({ email: normalized });
      if (insertError) {
        return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
      }
    }

    return { value: !alreadyExists, warnings: [] };
  } catch {
    return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}

export async function getMailingListSubscribers(): Promise<StateResult<string[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { value: [], warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const { data, error } = await supabase
      .from("dining_subscribers")
      .select("email")
      .order("created_at", { ascending: true });
    if (error) {
      return { value: [], warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const existing = uniqueSubscribers((data ?? []).map((entry) => entry.email));
    return { value: existing, warnings: [] };
  } catch {
    return { value: [], warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
  }
}

export async function removeMailingListSubscriber(email: string): Promise<StateResult<boolean>> {
  const normalized = email.trim().toLowerCase();
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { value: false, warnings: ["SUBSCRIBERS_DISABLED"] };
  }

  try {
    const { data: existing, error: readError } = await supabase
      .from("dining_subscribers")
      .select("email")
      .eq("email", normalized)
      .limit(1);
    if (readError) {
      return { value: false, warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
    }

    const existed = (existing ?? []).some((entry) => entry.email === normalized);
    if (existed) {
      const { error: deleteError } = await supabase
        .from("dining_subscribers")
        .delete()
        .eq("email", normalized);
      if (deleteError) {
        return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
      }
    }

    return { value: existed, warnings: [] };
  } catch {
    return { value: false, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}
