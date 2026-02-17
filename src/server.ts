import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "./db";
import { enqueueMixTask } from "./queue";
import { hashCookie, resolvePlaylistIds } from "./utils";

// 创建 Express 应用实例
const app = express();

// 启用 CORS (允许跨域请求)，方便前端开发调试
app.use(cors());

// 配置 JSON 解析器，限制请求体最大 1MB
app.use(express.json({ limit: "1mb" }));

// 设置静态文件目录，把 public 文件夹下的 html/css/js 暴露出去
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

// 定义输入验证规则 (Schema)
// 作用：确保前端发来的数据格式是正确的，防止乱七八糟的数据搞崩后台
const mixRequestSchema = z.object({
  cookie: z.string().min(10), // Cookie 至少 10 个字符
  sourceUrls: z.array(z.string().min(1)).min(2).max(10), // 源歌单 2-10 个
  maxTotalDuration: z.number().int().positive() // 目标时长必须是正整数
});

/**
 * 辅助函数：检查一个 URL 是否有效
 * @param url 要检查的链接
 * @returns { ok: boolean, status: number }
 */
const checkUrl = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: "HEAD", // 只请求头信息，不下载内容，速度快
      redirect: "follow",
      signal: AbortSignal.timeout(8000) // 8秒超时
    });
    return { ok: response.ok, status: response.status, finalUrl: response.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return { ok: false, error: message };
  }
};

/**
 * API: 提交混音任务
 * POST /api/mix
 */
app.post("/api/mix", async (req, res) => {
  try {
    // 1. 验证用户输入
    const payload = mixRequestSchema.parse(req.body);
    
    // 2. 规范化 Cookie
    // 有些用户可能只复制了 MUSIC_U 的值，这里帮他补全 key
    let cookie = payload.cookie.trim();
    if (!cookie.includes("=") && cookie.length > 20) {
      cookie = `MUSIC_U=${cookie}`;
    }

    // 3. 解析歌单链接为 ID
    const sourceIds = await resolvePlaylistIds(payload.sourceUrls);
    
    // 再次检查 ID 数量是否合法
    if (sourceIds.length < 2 || sourceIds.length > 10) {
      return res.status(400).json({ error: "sourceUrls_invalid" });
    }

    // 4. 记录或更新用户信息
    // 使用 Cookie 的哈希值作为 User ID，保护隐私
    const userId = hashCookie(cookie);
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        platform: "netease",
        cookie: cookie,
        lastLoginTime: new Date()
      },
      update: {
        cookie: cookie, // 每次提交更新 Cookie，保证是最新的
        lastLoginTime: new Date()
      }
    });

    // 5. 创建任务记录
    const taskId = randomUUID();
    await prisma.task.create({
      data: {
        id: taskId,
        ownerId: userId,
        status: "Pending", // 初始状态：等待中
        progress: 0,
        configJson: JSON.stringify({
          maxTotalDuration: payload.maxTotalDuration,
          sourceIds,
          cookie // 虽然 User 表存了 Cookie，这里存一份快照也行
        })
      }
    });

    // 6. 将任务加入队列
    await enqueueMixTask(taskId);

    // 7. 立即返回任务 ID 给前端，不让用户干等
    return res.json({ taskId });
  } catch (_error) {
    // 如果是 Zod 验证失败或其他错误，返回 400
    return res.status(400).json({ error: "bad_request" });
  }
});

/**
 * API: 查询任务进度
 * GET /api/task/:id
 */
app.get("/api/task/:id", async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id }
  });
  
  if (!task) {
    return res.status(404).json({ error: "not_found" });
  }
  
  // 如果有分布数据，解析一下 JSON
  const distribution = task.distributionJson
    ? JSON.parse(task.distributionJson)
    : null;
    
  // 返回前端需要展示的数据
  return res.json({
    id: task.id,
    status: task.status,
    progress: task.progress,
    resultUrl: task.resultUrl,
    errorMessage: task.errorMessage,
    actualTotalDuration: task.actualTotalDuration,
    distribution
  });
});

/**
 * API: 健康检查
 * 用于监控服务是否存活
 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * API: 诊断接口
 * 检查能否连通网易云服务器
 */
app.get("/api/diagnose", async (_req, res) => {
  const music = await checkUrl("https://music.163.com");
  const short = await checkUrl("https://163cn.tv");
  res.json({ music, short });
});

/**
 * 兜底路由
 * 所有未匹配 API 的请求，都返回前端首页 (index.html)
 * 这样用户刷新页面时不会 404
 */
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// 启动服务器
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  process.stdout.write(`Server running on http://localhost:${port}\n`);
});
