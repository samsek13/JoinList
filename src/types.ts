/**
 * 定义歌曲 (Track) 的结构
 * 
 * 作用：在代码中传递歌曲信息时，必须包含这些字段。
 */
export type Track = {
  id: number;          // 网易云音乐的歌曲 ID
  title: string;       // 歌曲标题
  artists: string[];   // 歌手列表 (可能有多个歌手)
  duration: number;    // 歌曲时长 (单位：秒)
  sign: string;        // 用于去重的唯一指纹 (标题+歌手)
};

/**
 * 定义歌单池 (TrackPool) 的结构
 * 
 * 作用：表示一个源歌单及其包含的所有可用歌曲。
 * 就像一个装满候选歌曲的“池子”。
 */
export type TrackPool = {
  sourceId: string;    // 源歌单 ID
  sourceName: string;  // 源歌单名称 (如 "我的喜欢")
  tracks: Track[];     // 该歌单里包含的歌曲列表
  totalDuration: number; // 该歌单所有歌曲的总时长 (秒)
};

/**
 * 定义结果分布项 (DistributionItem)
 * 
 * 作用：用于最后生成的报告，告诉用户每个源歌单贡献了多少内容。
 */
export type DistributionItem = {
  sourceId: string;      // 源歌单 ID
  sourceName: string;    // 源歌单名称
  contributedTime: number; // 贡献的总时长 (秒)
  songCount: number;     // 贡献的歌曲数量
};

/**
 * 定义混音配置 (MixConfig)
 * 
 * 作用：存储用户在前端填写的需求。
 */
export type MixConfig = {
  maxTotalDuration: number; // 用户设定的目标总时长 (秒)
  sourceUrls: string[];     // 用户输入的源歌单链接列表
  cookie: string;           // 用户的登录 Cookie
  weights?: (number | null)[];
};

/**
 * 定义混音结果 (MixResult)
 * 
 * 作用：混音算法计算完成后的返回值。
 */
export type MixResult = {
  actualTotalDuration: number;    // 实际生成的总时长
  distribution: DistributionItem[]; // 分布统计报告
  trackIds: number[];             // 最终选中的所有歌曲 ID
};
