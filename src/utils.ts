import crypto from "crypto";

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export const shuffle = <T>(items: T[]) => {
  const array = items.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

export const parsePlaylistId = (input: string) => {
  const trimmed = input.trim();
  const directMatch = trimmed.match(/^(\d+)$/);
  if (directMatch) {
    return directMatch[1];
  }
  const idMatch = trimmed.match(/[?&]id=(\d+)/);
  if (idMatch) {
    return idMatch[1];
  }
  return null;
};

export const parsePlaylistIds = (inputs: string[]) => {
  const ids: string[] = [];
  for (const input of inputs) {
    const candidate = parsePlaylistId(input);
    if (!candidate) {
      continue;
    }
    if (!ids.includes(candidate)) {
      ids.push(candidate);
    }
  }
  return ids;
};

export const resolvePlaylistIds = async (inputs: string[]) => {
  const ids: string[] = [];
  for (const input of inputs) {
    let candidate = parsePlaylistId(input);
    if (!candidate && /^https?:\/\//i.test(input)) {
      try {
        const response = await fetch(input, { redirect: "follow" });
        candidate = parsePlaylistId(response.url);
      } catch (error) {
        candidate = null;
      }
    }
    if (!candidate) {
      continue;
    }
    if (!ids.includes(candidate)) {
      ids.push(candidate);
    }
  }
  return ids;
};

export const normalizeSign = (title: string, artist: string) =>
  `${title}`.trim().toLowerCase() + "##" + `${artist}`.trim().toLowerCase();

export const hashCookie = (cookie: string) =>
  crypto.createHash("sha256").update(cookie).digest("hex");
