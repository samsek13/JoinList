import {
  playlist_create,
  playlist_detail,
  playlist_track_all,
  playlist_tracks
} from "NeteaseCloudMusicApi";
import { Track } from "../types";
import { normalizeSign, randomInt, sleep } from "../utils";

/**
 * 网易云音乐服务提供者类
 * 
 * 作用：封装所有与网易云 API 的交互逻辑。
 * 它把复杂的 API 调用（如翻页、鉴权）包装成简单的方法供外部调用。
 */
export class NeteaseProvider {
  private cookie: string; // 用户的登录凭证

  constructor(cookie: string) {
    this.cookie = cookie;
  }

  /**
   * 获取歌单的基本信息（元数据）
   * @param id 歌单 ID
   * @returns { id, name }
   */
  async fetchPlaylistMeta(id: string) {
    // 调用 API 获取详情
    const response = await playlist_detail({ id, cookie: this.cookie });
    const body = (response as any)?.body ?? response;
    
    // 检查 API 是否返回成功 (code 200)
    if (body?.code && body.code !== 200) {
      throw new Error(`Netease playlist_detail failed: ${body.code}`);
    }
    
    // 提取歌单名称
    const name = body?.playlist?.name ?? `Playlist ${id}`;
    return { id, name };
  }

  /**
   * 获取歌单内的所有歌曲
   * @param id 歌单 ID
   * @returns Track[] 歌曲列表
   * 
   * 作用：因为一个歌单可能有很多歌（比如 1000 首），API 通常一次只给 100 首。
   * 这个函数会自动一页一页地抓取，直到把所有歌都抓完。
   */
  async fetchPlaylistTracks(id: string) {
    const tracks: Track[] = [];
    let offset = 0; // 当前抓取到的偏移量（第几首开始）
    const limit = 100; // 每次抓取的数量
    
    // 循环抓取，直到没有更多歌曲
    while (true) {
      const response = await playlist_track_all({
        id,
        cookie: this.cookie,
        limit,
        offset
      });
      const body = (response as any)?.body ?? response;
      
      if (body?.code && body.code !== 200) {
        throw new Error(`Netease playlist_track_all failed: ${body.code}`);
      }
      
      const songs = (body as any)?.songs ?? [];
      
      // 处理每一首抓到的歌，提取我们需要的信息
      for (const song of songs) {
        const title = song?.name ?? "";
        // 提取所有歌手名
        const artists = (song?.ar ?? []).map((artist: { name: string }) =>
          artist?.name ? `${artist.name}` : ""
        );
        const firstArtist = artists[0] ?? "";
        // 网易云返回的时长是毫秒，我们转换为秒
        const duration = Math.floor((song?.dt ?? 0) / 1000);
        
        tracks.push({
          id: song?.id,
          title,
          artists,
          duration,
          // 生成去重指纹
          sign: normalizeSign(title, firstArtist)
        });
      }
      
      // 如果这次抓到的少于 limit，说明已经是最后一页了，退出循环
      if (!songs.length || songs.length < limit) {
        break;
      }
      
      // 准备抓下一页
      offset += limit;
      // 随机休息一下，防止被网易云封 IP
      await sleep(randomInt(100, 500));
    }
    return tracks;
  }

  /**
   * 创建新歌单并添加歌曲
   * @param name 新歌单的名称
   * @param trackIds 要加入的歌曲 ID 列表
   * @returns 新歌单的 URL 链接
   */
  async createPlaylist(name: string, trackIds: number[]) {
    // 1. 先创建一个空歌单
    const createResponse = await playlist_create({
      name,
      privacy: 0, // 0 表示公开歌单 (虽然 API 定义可能变化，但这通常是默认值)
      cookie: this.cookie
    });
    const createBody = (createResponse as any)?.body ?? createResponse;
    
    if (createBody?.code && createBody.code !== 200) {
      throw new Error(`Netease playlist_create failed: ${createBody.code}`);
    }
    
    const playlistId =
      (createBody as any)?.playlist?.id ?? (createBody as any)?.id;

    // 2. 批量把歌加进去
    // 网易云 API 限制一次最多加几百首，为了保险我们按 50 首一组分批加
    const chunkSize = 50;
    for (let i = 0; i < trackIds.length; i += chunkSize) {
      const chunk = trackIds.slice(i, i + chunkSize);
      
      const response = await playlist_tracks({
        op: "add", // 操作类型：添加
        pid: playlistId, // 目标歌单 ID
        tracks: chunk.join(","), // 歌曲 ID 用逗号拼接
        cookie: this.cookie
      });
      
      const body = (response as any)?.body ?? response;
      if (body?.code && body.code !== 200) {
        throw new Error(`Netease playlist_tracks failed: ${body.code}`);
      }
      
      // 每加一批休息一下
      await sleep(randomInt(100, 500));
    }
    
    // 返回新歌单的网页链接
    return `https://music.163.com/#/playlist?id=${playlistId}`;
  }
}
