import type { Track, IProvider } from "./types";

export interface MatchResult {
  matchedTracks: Track[];
  skippedCount: number;
}

const CONCURRENCY_LIMIT = 5;

/**
 * Cross-platform track matching
 * Search tracks on target platform and select closest duration match
 */
export async function matchTracksToTargetPlatform(
  sourceTracks: Track[],
  sourcePlatform: string,
  outputPlatform: string,
  outputProvider: IProvider
): Promise<MatchResult> {
  // Same platform, no matching needed
  if (sourcePlatform === outputPlatform) {
    return { matchedTracks: sourceTracks, skippedCount: 0 };
  }

  const matchedTracks: Track[] = [];
  let skippedCount = 0;

  // Batch concurrent search, max 5 per batch
  for (let i = 0; i < sourceTracks.length; i += CONCURRENCY_LIMIT) {
    const batch = sourceTracks.slice(i, i + CONCURRENCY_LIMIT);

    const results = await Promise.allSettled(
      batch.map(async (track) => {
        const query = `${track.title} ${track.artists[0] || ""}`;
        return await outputProvider.searchTrack(query, track.duration);
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        matchedTracks.push(result.value);
      } else {
        skippedCount++;
      }
    }
  }

  return { matchedTracks, skippedCount };
}

/**
 * Build skip statistics for frontend display
 */
export interface SkipStats {
  sourceName: string;
  skippedCount: number;
  reason: string;
}

export function buildSkipStats(
  sourceName: string,
  skippedCount: number
): SkipStats {
  return {
    sourceName,
    skippedCount,
    reason: "cross_platform_no_match"
  };
}
