import crypto from "crypto";
import type { UrlExtractionResult, UrlExtractionError, PlaylistResolveResult } from "./types";

/**
 * 等待指定的时间 (Sleep)
 * @param ms 毫秒数
 * @returns Promise，在指定时间后 resolve
 * 
 * 作用：暂停程序的执行。这在调用外部 API 时很有用，比如为了避免请求太快被封号，
 * 我们可以在两次请求之间“睡”一会儿。
 */
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 生成一个指定范围内的随机整数
 * @param min 最小值
 * @param max 最大值
 * @returns [min, max] 之间的随机整数
 * 
 * 作用：比如 randomInt(100, 500) 会返回 100 到 500 之间的一个数字。
 * 常用于生成随机延迟时间。
 */
export const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * 数组洗牌算法 (Fisher-Yates Shuffle)
 * @param items 原始数组
 * @returns 打乱顺序后的新数组
 * 
 * 作用：就像洗扑克牌一样，把数组里的元素顺序完全打乱。
 * 这是实现“随机播放”或“随机抽取”的核心函数。
 */
export const shuffle = <T>(items: T[]) => {
  const array = items.slice(); // 复制一份数组，以免修改原数组
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    // 交换位置
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// ==================== 链接提取相关函数 ====================

/**
 * 网易云音乐URL匹配正则
 *
 * 匹配规则：
 * - https?://          匹配 http 或 https 协议
 * - (?:163cn\.tv|music\.163\.com)  匹配短链接或长链接域名
 * - [^\s<>"']*         匹配链接内容直到空白符或常见分隔符
 */
const NETEASE_URL_PATTERN = /https?:\/\/(?:163cn\.tv|music\.163\.com)[^\s<>"']*/gi;

/**
 * 输入最大长度限制
 */
const MAX_INPUT_LENGTH = 2000;

/**
 * 显示用最大长度限制
 */
const MAX_DISPLAY_LENGTH = 100;

/**
 * 截断原始输入，用于错误响应显示
 * @param input 原始输入
 * @returns 截断后的输入（最多100字符）
 */
export const truncateInput = (input: string): string => {
  if (input.length <= MAX_DISPLAY_LENGTH) {
    return input;
  }
  return input.slice(0, MAX_DISPLAY_LENGTH) + '...';
};

/**
 * 从输入文本中提取网易云音乐URL
 *
 * @param input 用户输入的文本
 * @returns 提取结果，包含成功状态、URL或错误信息
 *
 * @example
 * // 成功提取
 * extractNeteaseUrl("分享歌单: 名称 https://163cn.tv/abc (@网易云音乐)")
 * // => { success: true, url: "https://163cn.tv/abc" }
 *
 * @example
 * // 未找到链接
 * extractNeteaseUrl("这是一段没有链接的文字")
 * // => { success: false, error: { code: 'not_found', ... } }
 *
 * @example
 * // 找到多个链接
 * extractNeteaseUrl("https://163cn.tv/a https://163cn.tv/b")
 * // => { success: false, error: { code: 'multiple', ... } }
 */
export const extractNeteaseUrl = (input: string): UrlExtractionResult => {
  // 输入长度检查
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      success: false,
      error: {
        code: 'not_found',
        message: '输入内容过长，请检查',
        originalInput: input.slice(0, 100) + '...'
      }
    };
  }

  const trimmed = input.trim();

  // 使用正则匹配所有网易云链接
  const matches = trimmed.match(NETEASE_URL_PATTERN);

  // 情况1：未找到链接
  if (!matches || matches.length === 0) {
    return {
      success: false,
      error: {
        code: 'not_found',
        message: '未识别到有效的歌单链接，请检查输入（建议直接粘贴网易云APP歌单分享文本）',
        originalInput: input
      }
    };
  }

  // 情况2：找到多个链接
  if (matches.length > 1) {
    return {
      success: false,
      error: {
        code: 'multiple',
        message: '输入包含多个链接，请分开输入',
        originalInput: input
      }
    };
  }

  // 情况3：找到唯一链接，返回成功
  return {
    success: true,
    url: matches[0]
  };
};

/**
 * 从输入字符串中提取歌单 ID
 *
 * @param input 可能是 URL，也可能是纯数字 ID
 * @returns 提取出的数字 ID 字符串，如果没有找到则返回 null
 *
 * @example
 * parsePlaylistId("12345")                           // => "12345"
 * parsePlaylistId("https://music.163.com/playlist?id=12345")  // => "12345"
 * parsePlaylistId("https://music.163.com/#/playlist?id=12345") // => "12345"
 * parsePlaylistId("https://music.163.com/playlist?id=12345&userid=67890") // => "12345"
 */
export const parsePlaylistId = (input: string): string | null => {
  const trimmed = input.trim();
  // 尝试直接匹配纯数字
  const directMatch = trimmed.match(/^(\d+)$/);
  if (directMatch) {
    return directMatch[1];
  }
  // 尝试从 URL 参数中匹配 id=xxxxx
  const idMatch = trimmed.match(/[?&]id=(\d+)/);
  if (idMatch) {
    return idMatch[1];
  }
  return null;
};

/**
 * 批量解析歌单 ID (简单版)
 * @param inputs 用户输入的字符串数组
 * @returns 有效的 ID 数组
 * 
 * 作用：循环调用 parsePlaylistId，把一堆输入转换成一堆 ID，并过滤掉无效的。
 */
export const parsePlaylistIds = (inputs: string[]) => {
  const ids: string[] = [];
  for (const input of inputs) {
    const candidate = parsePlaylistId(input);
    if (!candidate) {
      continue;
    }
    // 去重：如果这个 ID 已经在列表里了，就不再添加
    if (!ids.includes(candidate)) {
      ids.push(candidate);
    }
  }
  return ids;
};

/**
 * 解析用户输入，获取歌单ID
 *
 * @param input 用户输入（可以是分享文本、URL、纯数字ID）
 * @returns 解析结果，包含成功状态、歌单ID或错误信息
 *
 * 处理流程：
 * 1. 尝试直接解析纯数字ID
 * 2. 从文本中提取URL（处理分享文本）
 * 3. 检查URL是否为歌单格式
 * 4. 尝试直接提取ID或通过重定向解析
 */
export const resolvePlaylistId = async (
  input: string
): Promise<PlaylistResolveResult> => {
  const trimmed = input.trim();

  // Step 1: 尝试直接解析纯数字ID
  const directId = trimmed.match(/^(\d+)$/)?.[1];
  if (directId) {
    return { success: true, id: directId };
  }

  // Step 2: 从文本中提取URL
  const extraction = extractNeteaseUrl(trimmed);
  if (!extraction.success) {
    return {
      success: false,
      error: extraction.error
    };
  }

  const url = extraction.url!;

  // Step 3: 检查URL是否为歌单格式（用于提前识别非歌单链接）
  const isPlaylistUrlPattern = /(?:\/playlist|#\/playlist)/i.test(url);

  // Step 4: 尝试从URL中直接提取ID
  let candidate = parsePlaylistId(url);

  // Step 5: 如果无法直接提取或是短链接，尝试重定向解析
  if (!candidate) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000)
      });
      const finalUrl = response.url;
      candidate = parsePlaylistId(finalUrl);

      // 检查重定向后的URL是否为歌单
      if (!candidate || !/(?:\/playlist|#\/playlist)/i.test(finalUrl)) {
        return {
          success: false,
          error: {
            code: 'invalid_format',
            message: '链接格式无效，请输入歌单链接而非单曲/专辑链接',
            originalInput: input
          }
        };
      }
    } catch {
      return {
        success: false,
        error: {
          code: 'not_found',
          message: '无法访问链接，请检查链接是否有效',
          originalInput: input
        }
      };
    }
  } else if (!isPlaylistUrlPattern) {
    // 有ID但URL模式不匹配歌单（如单曲链接带id参数）
    // 需要进一步验证
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000)
      });
      const finalUrl = response.url;
      if (!/(?:\/playlist|#\/playlist)/i.test(finalUrl)) {
        return {
          success: false,
          error: {
            code: 'invalid_format',
            message: '链接格式无效，请输入歌单链接而非单曲/专辑链接',
            originalInput: input
          }
        };
      }
    } catch {
      // 网络错误时保守处理，返回已提取的ID
      // （可能是有效的歌单链接，只是无法验证）
    }
  }

  if (!candidate) {
    return {
      success: false,
      error: {
        code: 'invalid_format',
        message: '链接格式无效，请输入歌单链接',
        originalInput: input
      }
    };
  }

  return { success: true, id: candidate };
};

/**
 * 生成歌曲的唯一“指纹”
 * @param title 歌曲标题
 * @param artist 歌手名
 * @returns 标准化的签名字符串
 * 
 * 作用：用于去重。比如 "十年" 和 "陈奕迅"，生成的指纹可能是 "十年##陈奕迅"。
 * 我们忽略大小写和空格，确保 "Hello" 和 "hello" 被视为同一首歌。
 */
export const normalizeSign = (title: string, artist: string) =>
  `${title}`.trim().toLowerCase() + "##" + `${artist}`.trim().toLowerCase();

/**
 * 对 Cookie 进行哈希加密
 * @param cookie 原始 Cookie 字符串
 * @returns SHA256 哈希值 (64位字符)
 * 
 * 作用：我们不希望直接用 Cookie 当作数据库的主键（太长且不安全）。
 * 这里把 Cookie 转换成一个唯一的、固定长度的字符串作为 User ID。
 */
export const hashCookie = (cookie: string) =>
  crypto.createHash("sha256").update(cookie).digest("hex");

const getCookieKey = () => {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    return null;
  }
  return crypto.createHash("sha256").update(secret).digest();
};

export const encryptCookie = (cookie: string) => {
  const key = getCookieKey();
  if (!key) {
    throw new Error("cookie_secret_missing");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(cookie, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
};

export const decryptCookie = (encrypted: string) => {
  const key = getCookieKey();
  if (!key) {
    throw new Error("cookie_secret_missing");
  }
  const parts = encrypted.split(".");
  if (parts.length !== 3) {
    throw new Error("cookie_decrypt_failed");
  }
  const [ivText, tagText, dataText] = parts;
  const iv = Buffer.from(ivText, "base64");
  const tag = Buffer.from(tagText, "base64");
  const data = Buffer.from(dataText, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
};
