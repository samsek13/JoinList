import { prisma } from "./db";
import { NeteaseProvider } from "./provider/netease";
import { mixTrackPools } from "./mixer";
import { TrackPool } from "./types";
import { decryptCookie } from "./utils";

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
 * 作用：这是整个后台任务的“指挥官”。它负责协调各个步骤：
 * 1. 读任务配置
 * 2. 抓取歌单 (调用 Provider)
 * 3. 计算混音 (调用 Mixer)
 * 4. 创建歌单 (调用 Provider)
 * 5. 更新数据库
 */
export const processMixTask = async (taskId: string) => {
  // 1. 从数据库获取任务详情，并把关联的用户信息(包含 Cookie)也查出来
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { owner: true }
  });
  
  // 如果任务不存在（极其罕见），直接结束
  if (!task) {
    return;
  }

  try {
    const config = JSON.parse(task.configJson) as {
      maxTotalDuration: number;
      sourceIds: string[];
      weights?: number[];
    };
    const weights = normalizeWeights(config.weights, config.sourceIds.length);
    if (!task.owner.cookie) {
      throw new Error("cookie_missing");
    }
    const cookie = decryptCookie(task.owner.cookie);
    const provider = new NeteaseProvider(cookie);
    await updateTask(taskId, { status: "Processing", progress: 5 });

    const pools: TrackPool[] = [];
    const seen = new Set<string>(); // 用于全局去重
    
    // 计算总步骤数，用于显示进度条
    // 总步骤 = 歌单数量 (抓取耗时) + 2 (计算和创建)
    const totalSteps = config.sourceIds.length + 2;
    let currentStep = 0;

    // 2. 循环抓取每一个源歌单
    for (const sourceId of config.sourceIds) {
      // 获取歌单名
      const meta = await provider.fetchPlaylistMeta(sourceId);
      // 获取歌单里的所有歌
      const tracks = await provider.fetchPlaylistTracks(sourceId);
      
      // 2.1 执行去重逻辑
      // 如果这首歌之前已经出现过（在前面的歌单里），就跳过
      const uniqueTracks = tracks.filter((track) => {
        if (seen.has(track.sign)) {
          return false;
        }
        seen.add(track.sign); // 标记这首歌已出现
        return true;
      });
      
      // 计算去重后该歌单的总时长
      const totalDuration = uniqueTracks.reduce(
        (sum, track) => sum + track.duration,
        0
      );
      
      // 把处理好的数据放入池子
      pools.push({
        sourceId,
        sourceName: meta.name,
        tracks: uniqueTracks,
        totalDuration
      });
      
      // 更新进度条
      currentStep += 1;
      const progress = Math.min(
        75, // 抓取阶段最多占 75% 的进度
        Math.round((currentStep / totalSteps) * 75)
      );
      await updateTask(taskId, { progress });
    }

    // 检查一下是否所有歌单都被过滤空了
    if (pools.some((pool) => pool.totalDuration === 0)) {
      await updateTask(taskId, {
        status: "Failed",
        progress: 100,
        errorMessage: "playlist_empty_after_dedupe"
      });
      return;
    }

    // 3. 调用混音算法，计算出最终要选哪些歌
    const mixResult = mixTrackPools(
      pools,
      config.maxTotalDuration,
      weights ?? undefined
    );
    
    // 更新进度到 85%
    await updateTask(taskId, { progress: 85 });

    // 4. 在网易云创建新歌单
    const playlistName = `JoinList ${new Date().toISOString()}`;
    const description = mixResult.distribution
      .map((item) => {
        const minutes = (item.contributedTime / 60).toFixed(1);
        return `${item.sourceName} ${minutes} 分钟 ${item.songCount} 首`;
      })
      .join("\n");
    const resultUrl = await provider.createPlaylist(
      playlistName,
      mixResult.trackIds,
      description
    );
    
    // 5. 任务完成！保存结果 URL 和统计数据
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
      message === "cookie_secret_missing"
        ? "Failed"
        : message === "cookie_missing" || message === "cookie_decrypt_failed"
          ? "NeedAuth"
          : message.includes("301") || message.includes("cookie")
            ? "NeedAuth"
            : "Failed";
    await updateTask(taskId, {
      status,
      progress: 100,
      errorMessage: message
    });
  }
};
