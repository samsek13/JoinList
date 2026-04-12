import type { Track, IProvider } from "../types";
import { normalizeSign } from "../utils";

const MAX_TRACK_DURATION = 600; // 10 minutes

// Global app-level token cache
let cachedAppToken: string | null = null;
let cachedAppTokenExpires: number = 0;
let appTokenPromise: Promise<string> | null = null;

export class SoundCloudProvider implements IProvider {
  private accessToken: string | null;
  private refreshToken: string | null;
  private clientId: string;
  private clientSecret: string;
  private userId?: string;

  constructor(accessToken?: string, refreshToken?: string, userId?: string) {
    this.accessToken = accessToken || null;
    this.refreshToken = refreshToken || null;
    this.clientId = process.env.SOUNDCLOUD_CLIENT_ID!;
    this.clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET!;
    this.userId = userId;
  }

  /**
   * Get app-level token (Client Credentials Flow)
   * Global cache, concurrent-safe, refreshes when < 5 min to expiry
   */
  private async getAppToken(): Promise<string> {
    const now = Date.now();

    if (cachedAppToken && cachedAppTokenExpires > now + 5 * 60 * 1000) {
      return cachedAppToken;
    }

    if (appTokenPromise) {
      return appTokenPromise;
    }

    appTokenPromise = this.fetchAppToken();
    try {
      const token = await appTokenPromise;
      return token;
    } finally {
      appTokenPromise = null;
    }
  }

  private async fetchAppToken(): Promise<string> {
    const response = await fetch("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials"
      }).toString(),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error("app_token_fetch_failed");
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
    };

    cachedAppToken = data.access_token;
    cachedAppTokenExpires = Date.now() + data.expires_in * 1000;
    return data.access_token;
  }

  /**
   * Fetch wrapper with auto-refresh for user-level tokens
   */
  private async fetchWithAuth(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = this.accessToken || await this.getAppToken();

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `OAuth ${token}`);
    headers.set("accept", "application/json; charset=utf-8");

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(30000)
    });

    // If user token returned 401, try refresh once
    if (response.status === 401 && this.accessToken && this.refreshToken) {
      const newToken = await this.refreshUserToken(this.refreshToken);
      this.accessToken = newToken;

      // Persist refreshed token to DB
      if (this.userId) {
        try {
          const { encryptCookie, decryptCookie } = await import("../utils");
          const { prisma } = await import("../db");
          const encryptedAccess = encryptCookie(newToken);
          await prisma.user.update({
            where: { id: this.userId },
            data: { soundcloudToken: encryptedAccess }
          });
        } catch {
          // Non-blocking: if persist fails, the in-memory token still works for this task
        }
      }

      headers.set("Authorization", `OAuth ${newToken}`);
      return fetch(url, { ...options, headers, signal: AbortSignal.timeout(30000) });
    }

    return response;
  }

  /**
   * Refresh user-level token
   */
  private async refreshUserToken(refreshToken: string): Promise<string> {
    const response = await fetch("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }).toString(),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error("token_refresh_failed");
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /**
   * Resolve URL to playlist ID
   */
  async resolvePlaylistUrl(url: string): Promise<string> {
    // Handle short links
    if (url.includes("on.soundcloud.com")) {
      const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000) });
      url = response.url;
    }

    // Handle mobile links
    if (url.includes("m.soundcloud.com")) {
      url = url.replace("m.soundcloud.com", "soundcloud.com");
    }

    const resolveUrl = `https://api.soundcloud.com/resolve?url=${encodeURIComponent(url)}`;

    const response = await this.fetchWithAuth(resolveUrl);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("private_playlist_unauthorized");
      }
      throw new Error("playlist_resolve_failed");
    }

    const data = await response.json() as { id: number; kind: string };

    if (data.kind !== "playlist") {
      throw new Error("not_a_playlist");
    }

    return String(data.id);
  }

  /**
   * Fetch playlist metadata
   */
  async fetchPlaylistMeta(playlistId: string): Promise<{
    id: string;
    name: string;
    trackCount: number;
  }> {
    const url = `https://api.soundcloud.com/playlists/${playlistId}`;

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("private_playlist_unauthorized");
      }
      throw new Error("playlist_fetch_failed");
    }

    const data = await response.json() as {
      id: number;
      title: string;
      track_count: number;
    };

    return {
      id: String(data.id),
      name: data.title,
      trackCount: data.track_count
    };
  }

  /**
   * Fetch playlist tracks (filtered by duration > 10 min)
   */
  async fetchPlaylistTracks(playlistId: string): Promise<Track[]> {
    const url = `https://api.soundcloud.com/playlists/${playlistId}`;

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("private_playlist_unauthorized");
      }
      throw new Error("playlist_fetch_failed");
    }

    const data = await response.json() as {
      tracks: Array<{
        id: number;
        title: string;
        user: { username: string };
        duration: number;
      }>;
    };

    const tracks: Track[] = [];

    for (const track of (data.tracks || [])) {
      const duration = Math.floor(track.duration / 1000); // ms to seconds

      if (duration > MAX_TRACK_DURATION) {
        continue;
      }

      const artist = track.user?.username || "Unknown";

      tracks.push({
        id: String(track.id),
        title: track.title,
        artists: [artist],
        duration: duration,
        sign: normalizeSign(track.title, artist)
      });
    }

    return tracks;
  }

  /**
   * Search track on SoundCloud
   */
  async searchTrack(query: string, targetDuration?: number): Promise<Track | null> {
    const url = `https://api.soundcloud.com/tracks?q=${encodeURIComponent(query)}&limit=10`;

    let response = await this.fetchWithAuth(url);

    // Exponential backoff on 429 (max 3 retries)
    if (!response.ok && response.status === 429) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
        await new Promise(r => setTimeout(r, waitMs));
        response = await this.fetchWithAuth(url);
        if (response.ok) break;
      }
      if (!response.ok) {
        throw new Error("search_rate_limited");
      }
    }

    if (!response.ok) {
      throw new Error("search_failed");
    }

    const data = await response.json();
    return this.selectSearchResult(data, targetDuration);
  }

  private selectSearchResult(
    data: unknown,
    targetDuration?: number
  ): Track | null {
    const results = Array.isArray(data) ? data : [];

    if (results.length === 0) {
      return null;
    }

    if (targetDuration) {
      let bestMatch = results[0] as { id: number; title: string; user?: { username?: string }; duration: number };
      let bestDiff = Math.abs(Math.floor(bestMatch.duration / 1000) - targetDuration);

      for (const track of results) {
        const t = track as { id: number; title: string; user?: { username?: string }; duration: number };
        const diff = Math.abs(Math.floor(t.duration / 1000) - targetDuration);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = t;
        }
      }

      const artist = bestMatch.user?.username || "Unknown";
      return {
        id: String(bestMatch.id),
        title: bestMatch.title,
        artists: [artist],
        duration: Math.floor(bestMatch.duration / 1000),
        sign: normalizeSign(bestMatch.title, artist)
      };
    }

    const first = results[0] as { id: number; title: string; user?: { username?: string }; duration: number };
    const artist = first.user?.username || "Unknown";
    return {
      id: String(first.id),
      title: first.title,
      artists: [artist],
      duration: Math.floor(first.duration / 1000),
      sign: normalizeSign(first.title, artist)
    };
  }

  /**
   * Create playlist on SoundCloud (requires user-level token)
   */
  async createPlaylist(
    name: string,
    trackIds: string[],
    description?: string
  ): Promise<string> {
    if (!this.accessToken) {
      throw new Error("no_access_token");
    }

    const url = `https://api.soundcloud.com/playlists`;

    const response = await this.fetchWithAuth(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playlist: {
          title: name,
          description: description || "",
          tracks: trackIds.map(id => ({ id: Number(id.replace(/^soundcloud:tracks:/, "")) }))
        }
      })
    });

    if (!response.ok) {
      throw new Error("playlist_create_failed");
    }

    const data = await response.json() as {
      id: number;
      permalink_url: string;
    };

    return data.permalink_url;
  }
}
