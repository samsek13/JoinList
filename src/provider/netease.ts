import {
  playlist_create,
  playlist_detail,
  playlist_track_all,
  playlist_tracks
} from "NeteaseCloudMusicApi";
import { Track } from "../types";
import { normalizeSign, randomInt, sleep } from "../utils";

export class NeteaseProvider {
  private cookie: string;

  constructor(cookie: string) {
    this.cookie = cookie;
  }

  async fetchPlaylistMeta(id: string) {
    const response = await playlist_detail({ id, cookie: this.cookie });
    const body = (response as any)?.body ?? response;
    if (body?.code && body.code !== 200) {
      throw new Error(`Netease playlist_detail failed: ${body.code}`);
    }
    const name = body?.playlist?.name ?? `Playlist ${id}`;
    return { id, name };
  }

  async fetchPlaylistTracks(id: string) {
    const tracks: Track[] = [];
    let offset = 0;
    const limit = 100;
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
      for (const song of songs) {
        const title = song?.name ?? "";
        const artists = (song?.ar ?? []).map((artist: { name: string }) =>
          artist?.name ? `${artist.name}` : ""
        );
        const firstArtist = artists[0] ?? "";
        const duration = Math.floor((song?.dt ?? 0) / 1000);
        tracks.push({
          id: song?.id,
          title,
          artists,
          duration,
          sign: normalizeSign(title, firstArtist)
        });
      }
      if (!songs.length || songs.length < limit) {
        break;
      }
      offset += limit;
      await sleep(randomInt(100, 500));
    }
    return tracks;
  }

  async createPlaylist(name: string, trackIds: number[]) {
    const createResponse = await playlist_create({
      name,
      privacy: 0,
      cookie: this.cookie
    });
    const createBody = (createResponse as any)?.body ?? createResponse;
    if (createBody?.code && createBody.code !== 200) {
      throw new Error(`Netease playlist_create failed: ${createBody.code}`);
    }
    const playlistId =
      (createBody as any)?.playlist?.id ?? (createBody as any)?.id;
    const chunkSize = 50;
    for (let i = 0; i < trackIds.length; i += chunkSize) {
      const chunk = trackIds.slice(i, i + chunkSize);
      const response = await playlist_tracks({
        op: "add",
        pid: playlistId,
        tracks: chunk.join(","),
        cookie: this.cookie
      });
      const body = (response as any)?.body ?? response;
      if (body?.code && body.code !== 200) {
        throw new Error(`Netease playlist_tracks failed: ${body.code}`);
      }
      await sleep(randomInt(100, 500));
    }
    return `https://music.163.com/#/playlist?id=${playlistId}`;
  }
}
