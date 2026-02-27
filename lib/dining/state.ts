import { Redis } from "@upstash/redis";
import { ItemHistoryMap } from "@/lib/dining/types";

type StateResult<T> = {
  value: T;
  warnings: string[];
};

const KEY_LAST_RUN_AT = "dining:lastRunAt";
const KEY_ITEM_HISTORY = "dining:itemHistory";
const KEY_DIGEST_PREFIX = "dining:digest:";
const KEY_SUBSCRIBERS = "dining:subscribers";

let memoryLastRunAt: string | null = null;
const memorySubscribers = new Set<string>();

function uniqueSubscribers(input: string[]): string[] {
  return Array.from(new Set(input.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function getRedisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return Redis.fromEnv();
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
  const redis = getRedisClient();
  if (!redis) {
    const alreadyExists = memorySubscribers.has(normalized);
    if (!alreadyExists) {
      memorySubscribers.add(normalized);
    }
    return { value: !alreadyExists, warnings: ["STATE_DISABLED"] };
  }

  try {
    const existing = uniqueSubscribers((await redis.get<string[]>(KEY_SUBSCRIBERS)) ?? []);
    const alreadyExists = existing.includes(normalized);
    if (!alreadyExists) {
      existing.push(normalized);
      await redis.set(KEY_SUBSCRIBERS, existing);
    }
    return { value: !alreadyExists, warnings: [] };
  } catch {
    const alreadyExists = memorySubscribers.has(normalized);
    if (!alreadyExists) {
      memorySubscribers.add(normalized);
    }
    return { value: !alreadyExists, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}

export async function getMailingListSubscribers(): Promise<StateResult<string[]>> {
  const redis = getRedisClient();
  if (!redis) {
    return { value: [...memorySubscribers], warnings: ["STATE_DISABLED"] };
  }

  try {
    const existing = uniqueSubscribers((await redis.get<string[]>(KEY_SUBSCRIBERS)) ?? []);
    return { value: existing, warnings: [] };
  } catch {
    return { value: [...memorySubscribers], warnings: ["STATE_SUBSCRIBERS_READ_FAILED"] };
  }
}

export async function removeMailingListSubscriber(email: string): Promise<StateResult<boolean>> {
  const normalized = email.trim().toLowerCase();
  const redis = getRedisClient();
  if (!redis) {
    const existed = memorySubscribers.delete(normalized);
    return { value: existed, warnings: ["STATE_DISABLED"] };
  }

  try {
    const existing = uniqueSubscribers((await redis.get<string[]>(KEY_SUBSCRIBERS)) ?? []);
    const next = existing.filter((entry) => entry !== normalized);
    const existed = next.length !== existing.length;
    if (existed) {
      await redis.set(KEY_SUBSCRIBERS, next);
    }
    return { value: existed, warnings: [] };
  } catch {
    const existed = memorySubscribers.delete(normalized);
    return { value: existed, warnings: ["STATE_SUBSCRIBERS_WRITE_FAILED"] };
  }
}
