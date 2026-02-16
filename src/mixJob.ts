import { prisma } from "./db";
import { NeteaseProvider } from "./provider/netease";
import { mixTrackPools } from "./mixer";
import { TrackPool } from "./types";

const updateTask = async (taskId: string, data: Record<string, unknown>) => {
  await prisma.task.update({
    where: { id: taskId },
    data
  });
};

export const processMixTask = async (taskId: string) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { owner: true }
  });
  if (!task) {
    return;
  }
  try {
    const config = JSON.parse(task.configJson) as {
      maxTotalDuration: number;
      sourceIds: string[];
    };
    const provider = new NeteaseProvider(task.owner.cookie);
    await updateTask(taskId, { status: "Processing", progress: 5 });

    const pools: TrackPool[] = [];
    const seen = new Set<string>();
    const totalSteps = config.sourceIds.length + 2;
    let currentStep = 0;

    for (const sourceId of config.sourceIds) {
      const meta = await provider.fetchPlaylistMeta(sourceId);
      const tracks = await provider.fetchPlaylistTracks(sourceId);
      const uniqueTracks = tracks.filter((track) => {
        if (seen.has(track.sign)) {
          return false;
        }
        seen.add(track.sign);
        return true;
      });
      const totalDuration = uniqueTracks.reduce(
        (sum, track) => sum + track.duration,
        0
      );
      pools.push({
        sourceId,
        sourceName: meta.name,
        tracks: uniqueTracks,
        totalDuration
      });
      currentStep += 1;
      const progress = Math.min(
        75,
        Math.round((currentStep / totalSteps) * 75)
      );
      await updateTask(taskId, { progress });
    }

    if (pools.some((pool) => pool.totalDuration === 0)) {
      await updateTask(taskId, {
        status: "Failed",
        progress: 100,
        errorMessage: "playlist_empty_after_dedupe"
      });
      return;
    }

    const mixResult = mixTrackPools(pools, config.maxTotalDuration);
    await updateTask(taskId, { progress: 85 });

    const playlistName = `JoinList ${new Date().toISOString()}`;
    const resultUrl = await provider.createPlaylist(
      playlistName,
      mixResult.trackIds
    );
    await updateTask(taskId, {
      status: "Completed",
      progress: 100,
      resultUrl,
      actualTotalDuration: mixResult.actualTotalDuration,
      distributionJson: JSON.stringify(mixResult.distribution)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown_error";
    const status =
      message.includes("301") || message.includes("cookie")
        ? "NeedAuth"
        : "Failed";
    await updateTask(taskId, {
      status,
      progress: 100,
      errorMessage: message
    });
  }
};
