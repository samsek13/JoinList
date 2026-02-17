import crypto from "crypto";

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

/**
 * 从输入字符串中提取歌单 ID
 * @param input 可能是 URL，也可能是纯数字 ID
 * @returns 提取出的数字 ID 字符串，如果没有找到则返回 null
 * 
 * 作用：用户可能会粘贴 "https://music.163.com/playlist?id=12345" 或者直接粘贴 "12345"。
 * 这个函数负责把其中的 "12345" 提取出来。
 */
export const parsePlaylistId = (input: string) => {
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
 * 批量解析歌单 ID (高级版，支持短链接)
 * @param inputs 用户输入的字符串数组
 * @returns Promise<string[]> 解析后的 ID 数组
 * 
 * 作用：有些链接是短链接 (如 https://163cn.tv/xxx)，直接看不出 ID。
 * 这个函数会尝试发起一个网络请求，获取重定向后的真实 URL，再从中提取 ID。
 */
export const resolvePlaylistIds = async (inputs: string[]) => {
  const ids: string[] = [];
  for (const input of inputs) {
    let candidate = parsePlaylistId(input);
    
    // 如果直接解析失败，且看起来像个网址，尝试请求一下看是否重定向
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
