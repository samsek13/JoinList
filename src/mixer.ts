import { MixResult, TrackPool } from "./types";
import { shuffle } from "./utils";

/**
 * 混音核心算法引擎
 * @param pools 所有的源歌单池 (每个池子包含该歌单的歌曲)
 * @param maxTotalDuration 用户设定的最大总时长 (秒)
 * @returns MixResult 计算结果 (包含选中的歌、实际时长、分布统计)
 * 
 * 作用：这是整个应用最核心的“大脑”。它不关心网络请求，只负责做数学题：
 * 如何从 N 个歌单里凑出总时长为 T 的新歌单，且保证大家时长相等。
 */
export const mixTrackPools = (
  pools: TrackPool[],
  maxTotalDuration: number
): MixResult => {
  const poolCount = pools.length; // 源歌单的数量
  
  // 步骤 1：计算每个歌单的“理论目标时长”
  // 比如总时长 60分钟，有 3 个歌单，那每个歌单理论上应该出 20分钟。
  const initialTarget = Math.floor(maxTotalDuration / poolCount);
  
  // 步骤 2：获取每个歌单的“实际总时长”
  // 有可能某个歌单只有 5 分钟，根本凑不够 20 分钟。
  const poolDurations = pools.map((pool) => pool.totalDuration);
  
  // 步骤 3：确定最终的“单源目标时长” (tTarget)
  // 根据“木桶效应”，为了公平，大家的配额必须看那个“最短的歌单”。
  // 如果歌单 A 只有 5 分钟，那所有歌单都只能出 5 分钟。
  const tTarget = Math.min(initialTarget, ...poolDurations);
  
  const distribution = []; // 用于存放统计数据
  const trackIds: number[] = []; // 用于存放最终选中的歌曲 ID
  let actualTotalDuration = 0; // 记录实际凑出来的总时长

  // 步骤 4：开始对每个歌单进行抽取
  for (const pool of pools) {
    // 4.1 洗牌：先把歌单里的歌打乱，保证随机性
    const shuffled = shuffle(pool.tracks);
    
    let currentDuration = 0; // 当前歌单已选的时长
    const selectedIds: number[] = []; // 当前歌单已选的 ID
    
    // 4.2 贪心算法：按顺序一首首加，直到快溢出 tTarget
    for (const track of shuffled) {
      // 如果加上这首歌会超过目标时长，就跳过这首，看下一首
      if (currentDuration + track.duration > tTarget) {
        continue;
      }
      // 没超过，那就加上
      currentDuration += track.duration;
      selectedIds.push(track.id);
    }
    
    // 4.3 记录该歌单的贡献情况
    distribution.push({
      sourceId: pool.sourceId,
      sourceName: pool.sourceName,
      contributedTime: currentDuration,
      songCount: selectedIds.length
    });
    
    // 4.4 累加到全局结果
    actualTotalDuration += currentDuration;
    trackIds.push(...selectedIds);
  }

  // 返回最终结果
  return {
    actualTotalDuration,
    distribution,
    trackIds
  };
};
