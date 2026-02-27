export type MenuRecord = {
  date: string;
  hall: string;
  meal: string;
  station?: string;
  item: string;
  tags?: string[];
  raw?: unknown;
};

export type InterestingRecord = MenuRecord & {
  key: string;
  score: number;
  matchedIncludes: string[];
  matchedExcludes: string[];
  novelty: boolean;
  blocked: boolean;
};

export type GroupedInterestingItem = {
  item: string;
  key: string;
  score: number;
  novelty: boolean;
  matchedIncludes: string[];
  matchedExcludes: string[];
  appearances: Array<{
    hall: string;
    meal: string;
    station?: string;
  }>;
};

export type ItemHistoryMap = Record<
  string,
  {
    lastSeen: string;
    count: number;
  }
>;
