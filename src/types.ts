export type Track = {
  id: number;
  title: string;
  artists: string[];
  duration: number;
  sign: string;
};

export type TrackPool = {
  sourceId: string;
  sourceName: string;
  tracks: Track[];
  totalDuration: number;
};

export type DistributionItem = {
  sourceId: string;
  sourceName: string;
  contributedTime: number;
  songCount: number;
};

export type MixConfig = {
  maxTotalDuration: number;
  sourceUrls: string[];
  cookie: string;
};

export type MixResult = {
  actualTotalDuration: number;
  distribution: DistributionItem[];
  trackIds: number[];
};
