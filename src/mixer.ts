import { MixResult, TrackPool } from "./types";
import { shuffle } from "./utils";

export const mixTrackPools = (
  pools: TrackPool[],
  maxTotalDuration: number
): MixResult => {
  const poolCount = pools.length;
  const initialTarget = Math.floor(maxTotalDuration / poolCount);
  const poolDurations = pools.map((pool) => pool.totalDuration);
  const tTarget = Math.min(initialTarget, ...poolDurations);
  const distribution = [];
  const trackIds: number[] = [];
  let actualTotalDuration = 0;

  for (const pool of pools) {
    const shuffled = shuffle(pool.tracks);
    let currentDuration = 0;
    const selectedIds: number[] = [];
    for (const track of shuffled) {
      if (currentDuration + track.duration > tTarget) {
        continue;
      }
      currentDuration += track.duration;
      selectedIds.push(track.id);
    }
    distribution.push({
      sourceId: pool.sourceId,
      sourceName: pool.sourceName,
      contributedTime: currentDuration,
      songCount: selectedIds.length
    });
    actualTotalDuration += currentDuration;
    trackIds.push(...selectedIds);
  }

  return {
    actualTotalDuration,
    distribution,
    trackIds
  };
};
