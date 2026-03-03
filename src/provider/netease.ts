import {
  playlist_create,
  playlist_desc_update,
  playlist_detail,
  playlist_track_all,
  playlist_tracks
} from "NeteaseCloudMusicApi";
import { Track } from "../types";
import { normalizeSign, randomInt, sleep } from "../utils";

const getBody = (response: unknown) => {
  if (response && typeof response === "object" && "body" in response) {
    return (response as { body: unknown }).body;
  }
  return response;
};

const getCode = (body: unknown) => {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
};

const getPlaylistName = (body: unknown, id: string) => {
  if (body && typeof body === "object" && "playlist" in body) {
    const playlist = (body as { playlist?: unknown }).playlist;
    if (playlist && typeof playlist === "object" && "name" in playlist) {
      const name = (playlist as { name?: unknown }).name;
      if (typeof name === "string" && name.trim().length > 0) {
        return name;
      }
    }
  }
  return `Playlist ${id}`;
};

const getSongs = (body: unknown) => {
  if (body && typeof body === "object" && "songs" in body) {
    const songs = (body as { songs?: unknown }).songs;
    return Array.isArray(songs) ? songs : [];
  }
  return [];
};

const getPlaylistId = (body: unknown) => {
  if (body && typeof body === "object" && "playlist" in body) {
    const playlist = (body as { playlist?: unknown }).playlist;
    if (playlist && typeof playlist === "object" && "id" in playlist) {
      const id = (playlist as { id?: unknown }).id;
      if (typeof id === "number") {
        return id;
      }
    }
  }
  if (body && typeof body === "object" && "id" in body) {
    const id = (body as { id?: unknown }).id;
    if (typeof id === "number") {
      return id;
    }
  }
  return null;
};

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
    const body = getBody(response);
    const code = getCode(body);
    if (code && code !== 200) {
      throw new Error(`Netease playlist_detail failed: ${code}`);
    }
    const name = getPlaylistName(body, id);
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
      const body = getBody(response);
      const code = getCode(body);
      if (code && code !== 200) {
        throw new Error(`Netease playlist_track_all failed: ${code}`);
      }
      const songs = getSongs(body);
      
      // 处理每一首抓到的歌，提取我们需要的信息
      for (const song of songs) {
        const songRecord =
          song && typeof song === "object" ? (song as Record<string, unknown>) : {};
        const title =
          typeof songRecord.name === "string" ? songRecord.name : "";
        const artistsRaw = Array.isArray(songRecord.ar) ? songRecord.ar : [];
        const artists = artistsRaw
          .map((artist) => {
            if (artist && typeof artist === "object" && "name" in artist) {
              const name = (artist as { name?: unknown }).name;
              return typeof name === "string" ? name : "";
            }
            return "";
          })
          .filter((name) => name.length > 0);
        const firstArtist = artists[0] ?? "";
        const durationMs =
          typeof songRecord.dt === "number" ? songRecord.dt : 0;
        const duration = Math.floor(durationMs / 1000);
        
        tracks.push({
          id: typeof songRecord.id === "number" ? songRecord.id : 0,
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
  async createPlaylist(
    name: string,
    trackIds: number[],
    description?: string
  ) {
    const createResponse = await playlist_create({
      name,
      privacy: 0, // 0 表示公开歌单 (虽然 API 定义可能变化，但这通常是默认值)
      cookie: this.cookie
    });
    const createBody = getBody(createResponse);
    const createCode = getCode(createBody);
    if (createCode && createCode !== 200) {
      throw new Error(`Netease playlist_create failed: ${createCode}`);
    }
    const playlistId = getPlaylistId(createBody);
    if (!playlistId) {
      throw new Error("Netease playlist_create failed: missing playlist id");
    }

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
      const body = getBody(response);
      const code = getCode(body);
      if (code && code !== 200) {
        throw new Error(`Netease playlist_tracks failed: ${code}`);
      }
      
      // 每加一批休息一下
      await sleep(randomInt(100, 500));
    }
    if (description) {
      const response = await playlist_desc_update({
        id: playlistId,
        desc: description,
        cookie: this.cookie
      });
      const body = getBody(response);
      const code = getCode(body);
      if (code && code !== 200) {
        throw new Error(`Netease playlist_desc_update failed: ${code}`);
      }
    }
    // 返回新歌单的网页链接
    return `https://music.163.com/#/playlist?id=${playlistId}`;
  }
}
