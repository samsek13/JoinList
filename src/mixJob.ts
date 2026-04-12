import { prisma } from "./db";
import { NeteaseProvider } from "./provider/netease";
import { SoundCloudProvider } from "./provider/soundcloud";
import { mixTrackPools } from "./mixer";
import { TrackPool } from "./types";
import { decryptCookie } from "./utils";
import { matchTracksToTargetPlatform, buildSkipStats } from "./crossPlatformMatcher";
import type { SkipStats } from "./crossPlatformMatcher";
import { getDecryptedToken } from "./soundcloudAuth";

/**
 * 辅助函数：更新任务状态
 * @param taskId 任务 ID
 * @param data 要更新的字段 (比如进度 progress, 状态 status)
 */
const updateTask = async (taskId: string, data: Record<string, unknown>) => {
  await prisma.task.update({
    where: { id: taskId },
    data
  });
};

const normalizeWeights = (weights: number[] | undefined, count: number) => {
  if (!weights) {
    return null;
  }
  if (weights.length !== count) {
    throw new Error("weights_invalid");
  }
  const sum = weights.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 100) > 0.001) {
    throw new Error("weights_invalid");
  }
  if (weights.some((value) => value < 0 || value > 100)) {
    throw new Error("weights_invalid");
  }
  return weights;
};

/**
 * 处理混音任务的主流程
 * @param taskId 任务 ID
 *
 * 作用：这是整个后台任务的"指挥官"。它负责协调各个步骤：
 * 1. 读任务配置
 * 2. 抓取歌单 (调用 Provider，支持多平台)
 * 3. 跨平台匹配（若需要）
 * 4. 计算混音 (调用 Mixer)
 * 5. 创建歌单 (调用 Provider)
 * 6. 更新数据库
 */
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
      sourcePlatforms?: string[];
      sourceNames?: string[];
      weights?: number[];
      outputPlatform?: string;
    };

    // Backward compatibility defaults
    const sourcePlatforms = config.sourcePlatforms || config.sourceIds.map(() => "netease");
    const outputPlatform = config.outputPlatform || "netease";
    const sourceNames = config.sourceNames || [];
    const weights = normalizeWeights(config.weights, config.sourceIds.length);

    // Create output provider
    let outputProvider: NeteaseProvider | SoundCloudProvider;
    let scAccessToken: string | undefined;
    let scRefreshToken: string | undefined;

    if (outputPlatform === "soundcloud") {
      const scToken = await getDecryptedToken(task.owner.id);
      if (!scToken.accessToken) {
        throw new Error("soundcloud_not_bound");
      }
      scAccessToken = scToken.accessToken || undefined;
      scRefreshToken = scToken.refreshToken || undefined;
      outputProvider = new SoundCloudProvider(scAccessToken, scRefreshToken, task.owner.id);
    } else {
      if (!task.owner.cookie) {
        throw new Error("cookie_missing");
      }
      const cookie = decryptCookie(task.owner.cookie);
      outputProvider = new NeteaseProvider(cookie);
    }

    // Decrypt netease cookie once
    const neteaseCookie = task.owner.cookie ? decryptCookie(task.owner.cookie) : undefined;

    await updateTask(taskId, { status: "Processing", progress: 5 });

    const pools: TrackPool[] = [];
    const skipStats: SkipStats[] = [];

    // Platform-aware deduplication
    const platformSeen: Record<string, Set<string>> = {};

    const totalSteps = config.sourceIds.length + 2;
    let currentStep = 0;

    for (let i = 0; i < config.sourceIds.length; i++) {
      const sourceId = config.sourceIds[i];
      const sourcePlatform = sourcePlatforms[i];
      const sourceNameHint = sourceNames[i];

      // Create source provider (reuse decrypted credentials)
      let sourceProvider: NeteaseProvider | SoundCloudProvider;
      if (sourcePlatform === "soundcloud") {
        sourceProvider = new SoundCloudProvider(scAccessToken);
      } else {
        if (!neteaseCookie) {
          throw new Error("cookie_missing");
        }
        sourceProvider = new NeteaseProvider(neteaseCookie);
      }

      // Fetch playlist metadata
      const meta = await sourceProvider.fetchPlaylistMeta(sourceId);
      const sourceName = sourceNameHint || meta.name;

      // Fetch tracks
      const tracks = await sourceProvider.fetchPlaylistTracks(sourceId);

      // Platform-aware deduplication
      if (!platformSeen[sourcePlatform]) {
        platformSeen[sourcePlatform] = new Set<string>();
      }
      const seen = platformSeen[sourcePlatform];

      let uniqueTracks = tracks.filter((track) => {
        if (seen.has(track.sign)) return false;
        seen.add(track.sign);
        return true;
      });

      // Cross-platform matching
      let processedTracks = uniqueTracks;
      if (sourcePlatform !== outputPlatform) {
        const matchResult = await matchTracksToTargetPlatform(
          uniqueTracks,
          sourcePlatform,
          outputPlatform,
          outputProvider
        );
        processedTracks = matchResult.matchedTracks;

        if (matchResult.skippedCount > 0) {
          skipStats.push(buildSkipStats(sourceName, matchResult.skippedCount));
        }
      }

      const totalDuration = processedTracks.reduce(
        (sum, track) => sum + track.duration,
        0
      );

      pools.push({
        sourceId,
        sourceName,
        tracks: processedTracks,
        totalDuration
      });

      currentStep += 1;
      const progress = Math.min(75, Math.round((currentStep / totalSteps) * 75));
      await updateTask(taskId, { progress });
    }

    // Check empty pools
    if (pools.some((pool) => pool.totalDuration === 0)) {
      await updateTask(taskId, {
        status: "Failed",
        progress: 100,
        errorMessage: "playlist_empty_after_match"
      });
      return;
    }

    // Run mixing algorithm
    const mixResult = mixTrackPools(
      pools,
      config.maxTotalDuration,
      weights ?? undefined
    );

    await updateTask(taskId, { progress: 85 });

    // Create result playlist
    const playlistName = `JoinList ${new Date().toISOString()}`;
    const description = mixResult.distribution
      .map((item) => {
        const minutes = (item.contributedTime / 60).toFixed(1);
        return `${item.sourceName} ${minutes} 分钟 ${item.songCount} 首`;
      })
      .join("\n");

    const resultUrl = await outputProvider.createPlaylist(
      playlistName,
      mixResult.trackIds,
      description
    );

    // Save results with skip stats
    await updateTask(taskId, {
      status: "Completed",
      progress: 100,
      resultUrl,
      actualTotalDuration: mixResult.actualTotalDuration,
      distributionJson: JSON.stringify(mixResult.distribution),
      configJson: JSON.stringify({
        ...config,
        sourcePlatforms,
        outputPlatform,
        sourceNames,
        skipStats
      })
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown_error";
    const status =
      message === "cookie_secret_missing"
        ? "Failed"
        : message === "cookie_missing" || message === "cookie_decrypt_failed"
          ? "NeedAuth"
          : message === "soundcloud_not_bound"
            ? "NeedAuth"
            : message.includes("301") || message.includes("cookie")
              ? "NeedAuth"
              : message.includes("token") || message.includes("oauth")
                ? "NeedAuth"
                : "Failed";
    await updateTask(taskId, {
      status,
      progress: 100,
      errorMessage: message
    });
  }
};
