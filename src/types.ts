export type PrivacyMode = "full" | "busy" | "hidden";

export type CalendarSource = {
  name: string;
  url: string;
  privacy: PrivacyMode;
  prefix?: string;
};

export type CalendarEvent = {
  id: string;
  sourceName: string;
  privacy: PrivacyMode;
  start: Date;
  end: Date;
  summary?: string;
  description?: string;
  location?: string;
};

export type DateRange = {
  from: Date;
  to: Date;
};

export type CacheState = {
  value: string;
  expiresAt: number;
  generatedAt: Date;
};
