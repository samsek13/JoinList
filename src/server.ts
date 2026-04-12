import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { prisma } from "./db";
import { enqueueMixTask } from "./queue";
import { decryptCookie, encryptCookie, identifyPlatform, resolvePlaylistId, truncateInput } from "./utils";
import { createUser, authenticateUser } from "./auth";
import { authMiddleware } from "./middleware";
import type { UrlExtractionError } from "./types";
import {
  verifyAdminPassword,
  generateAdminToken,
  adminMiddleware
} from "./admin";
import {
  login_qr_check,
  login_qr_create,
  login_qr_key
} from "NeteaseCloudMusicApi";
import { startCleanupScheduler } from "./cleanup";
import {
  getAuthorizationUrl,
  storeOAuthState,
  verifyOAuthState,
  deleteOAuthState,
  exchangeCodeForToken,
  getSoundCloudUser,
  storeToken
} from "./soundcloudAuth";
import { SoundCloudProvider } from "./provider/soundcloud";

const app = express();
if (process.env.FORCE_HTTPS === "true") {
  app.set("trust proxy", 1);
}

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: "too_many_requests" },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  message: { error: "too_many_requests" },
  standardHeaders: true,
  legacyHeaders: false
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: { error: "too_many_requests" },
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/auth", authLimiter);
app.use("/api/admin/login", adminLimiter);
app.use("/api", apiLimiter);

app.use((req, res, next) => {
  if (process.env.FORCE_HTTPS !== "true") {
    return next();
  }
  const forwarded = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  if (proto !== "https") {
    return res.status(403).json({ error: "https_required" });
  }
  return next();
});

const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

// 输入验证规则
const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(6).max(128)
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const mixRequestSchema = z.object({
  sourceUrls: z.array(z.string().min(1)).min(2).max(10),
  maxTotalDuration: z.number().int().positive(),
  weights: z.array(z.number().min(0).max(100).nullable()).optional(),
  outputPlatform: z.enum(["netease", "soundcloud"]).optional()
});

const checkUrl = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    return { ok: response.ok, status: response.status, finalUrl: response.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return { ok: false, error: message };
  }
};

const normalizeWeights = (
  weights: (number | null)[],
  count: number
) => {
  if (!weights.length) {
    return null;
  }
  if (weights.length !== count) {
    throw new Error("weights_invalid");
  }
  let sumDefined = 0;
  let emptyCount = 0;
  const normalized = weights.map((value) => {
    if (value === null || Number.isNaN(value)) {
      emptyCount += 1;
      return null;
    }
    if (value < 0 || value > 100) {
      throw new Error("weights_invalid");
    }
    sumDefined += value;
    return value;
  });
  if (sumDefined > 100) {
    throw new Error("weights_invalid");
  }
  const remaining = 100 - sumDefined;
  if (emptyCount > 0) {
    const share = remaining / emptyCount;
    return normalized.map((value) => (value === null ? share : value)) as number[];
  }
  if (Math.abs(remaining) > 0.001) {
    throw new Error("weights_invalid");
  }
  return normalized as number[];
};

const getBody = (response: unknown) => {
  if (response && typeof response === "object" && "body" in response) {
    return (response as { body: unknown }).body;
  }
  return response;
};

// ==================== 认证相关 API ====================

/**
 * POST /api/auth/register
 * 用户注册
 */
app.post("/api/auth/register", async (req, res) => {
  try {
    const payload = registerSchema.parse(req.body);
    const email = payload.email && payload.email.trim() ? payload.email.trim() : undefined;

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username: payload.username }
    });
    if (existingUser) {
      return res.status(409).json({ ok: false, error: "用户名已存在" });
    }

    // 检查邮箱是否已存在
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email }
      });
      if (existingEmail) {
        return res.status(409).json({ ok: false, error: "邮箱已被注册" });
      }
    }

    const user = await createUser(payload.username, payload.password, email);
    return res.json({ ok: true, message: "注册成功，请登录", userId: user.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      return res.status(400).json({ ok: false, error: firstError?.message || "输入无效" });
    }
    const message = error instanceof Error ? error.message : "注册失败";
    return res.status(400).json({ ok: false, error: message });
  }
});

/**
 * POST /api/auth/login
 * 用户登录
 */
app.post("/api/auth/login", async (req, res) => {
  try {
    const payload = loginSchema.parse(req.body);
    const result = await authenticateUser(payload.username, payload.password);

    if (!result) {
      return res.status(401).json({ ok: false, error: "用户名或密码错误" });
    }

    // 检查是否为等待批准的错误
    if ("error" in result) {
      if (result.error === "account_pending_approval") {
        return res.status(403).json({ ok: false, error: "账户正在等待管理员批准，请稍后再试" });
      }
      return res.status(401).json({ ok: false, error: "登录失败" });
    }

    // 检查是否是等待批准的错误
    if ("error" in result) {
      return res.status(403).json({ ok: false, error: "账户正在等待管理员批准，请稍后再试" });
    }

    return res.json({ ok: true, token: result.token, user: result.user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: "输入无效" });
    }
    return res.status(400).json({ ok: false, error: "登录失败" });
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
app.get("/api/auth/me", authMiddleware, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      hasNeteaseCookie: !!req.user.cookie,
      hasSoundcloudToken: !!req.user.soundcloudToken
    }
  });
});

// ==================== 管理员相关 API ====================

const adminLoginSchema = z.object({
  password: z.string().min(1)
});

const userIdsSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100)
});

/**
 * POST /api/admin/login
 * 管理员登录
 */
app.post("/api/admin/login", async (req, res) => {
  try {
    const payload = adminLoginSchema.parse(req.body);

    // 验证密码
    const isValid = verifyAdminPassword(payload.password);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: "密码错误" });
    }

    // 生成 token
    const token = generateAdminToken();
    return res.json({ ok: true, token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: "输入无效" });
    }
    const message = error instanceof Error ? error.message : "登录失败";
    if (message === "ADMIN_PASSWORD not configured") {
      return res.status(500).json({ ok: false, error: "系统配置错误" });
    }
    return res.status(400).json({ ok: false, error: "登录失败" });
  }
});

/**
 * GET /api/admin/users
 * 获取所有用户列表
 */
app.get("/api/admin/users", adminMiddleware, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      isApproved: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json({ users });
});

/**
 * POST /api/admin/users/approve
 * 批准用户（支持批量）
 */
app.post("/api/admin/users/approve", adminMiddleware, async (req, res) => {
  try {
    const { userIds } = userIdsSchema.parse(req.body);

    const result = await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isApproved: true }
    });

    return res.json({ ok: true, approvedCount: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: "输入无效" });
    }
    return res.status(400).json({ ok: false, error: "操作失败" });
  }
});

/**
 * POST /api/admin/users/reject
 * 拒绝用户（支持批量，删除账户）
 */
app.post("/api/admin/users/reject", adminMiddleware, async (req, res) => {
  try {
    const { userIds } = userIdsSchema.parse(req.body);

    const result = await prisma.user.deleteMany({
      where: { id: { in: userIds } }
    });

    return res.json({ ok: true, rejectedCount: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: "输入无效" });
    }
    return res.status(400).json({ ok: false, error: "操作失败" });
  }
});

// ==================== 网易云相关 API ====================

/**
 * GET /api/netease/qr
 * 获取网易云登录二维码
 */
app.get("/api/netease/qr", authMiddleware, async (_req, res) => {
  const keyResponse = await login_qr_key({});
  const keyBody = getBody(keyResponse);
  const keyData =
    keyBody && typeof keyBody === "object" && "data" in keyBody
      ? (keyBody as { data?: unknown }).data
      : null;
  const key =
    keyData && typeof keyData === "object" && "unikey" in keyData
      ? ((keyData as { unikey?: unknown }).unikey as string | undefined)
      : keyBody && typeof keyBody === "object" && "unikey" in keyBody
        ? ((keyBody as { unikey?: unknown }).unikey as string | undefined)
        : undefined;
  if (!key) {
    return res.status(500).json({ error: "qr_key_failed" });
  }
  const qrResponse = await login_qr_create({
    key,
    qrimg: true
  });
  const qrBody = getBody(qrResponse);
  const qrData =
    qrBody && typeof qrBody === "object" && "data" in qrBody
      ? (qrBody as { data?: unknown }).data
      : null;
  const qrimg =
    qrData && typeof qrData === "object" && "qrimg" in qrData
      ? ((qrData as { qrimg?: unknown }).qrimg as string | undefined)
      : undefined;
  const qrurl =
    qrData && typeof qrData === "object" && "qrurl" in qrData
      ? ((qrData as { qrurl?: unknown }).qrurl as string | undefined)
      : undefined;
  return res.json({
    key,
    qrimg,
    qrurl
  });
});

/**
 * GET /api/netease/qr/check
 * 检查网易云扫码登录状态
 */
app.get("/api/netease/qr/check", authMiddleware, async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  if (!key) {
    return res.status(400).json({ error: "bad_request" });
  }

  const response = await login_qr_check({ key });
  const body = getBody(response);
  const code =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : null;
  const message =
    body && typeof body === "object" && "message" in body
      ? (body as { message?: unknown }).message
      : "";
  const cookie =
    body && typeof body === "object" && "cookie" in body
      ? (body as { cookie?: unknown }).cookie
      : null;

  // 如果扫码成功，保存 cookie 到用户记录
  if (code === 803 && typeof cookie === "string" && req.userId) {
    const encryptedCookie = encryptCookie(cookie);
    await prisma.user.update({
      where: { id: req.userId },
      data: { cookie: encryptedCookie }
    });
  }

  return res.json({
    code: typeof code === "number" ? code : null,
    message: typeof message === "string" ? message : "",
    cookie: typeof cookie === "string" ? cookie : null
  });
});

/**
 * POST /api/netease/bind-cookie
 * 手动绑定网易云 Cookie
 */
app.post("/api/netease/bind-cookie", authMiddleware, async (req, res) => {
  try {
    const { cookie } = req.body as { cookie?: string };
    if (!cookie || typeof cookie !== "string" || cookie.length < 10) {
      return res.status(400).json({ error: "cookie_invalid" });
    }

    let normalizedCookie = cookie.trim();
    if (!normalizedCookie.includes("=") && normalizedCookie.length > 20) {
      normalizedCookie = `MUSIC_U=${normalizedCookie}`;
    }

    const encryptedCookie = encryptCookie(normalizedCookie);
    await prisma.user.update({
      where: { id: req.userId },
      data: { cookie: encryptedCookie }
    });

    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bind_failed";
    if (message === "cookie_secret_missing") {
      return res.status(500).json({ error: "cookie_secret_missing" });
    }
    return res.status(400).json({ error: "bind_failed" });
  }
});

/**
 * POST /api/netease/clear-cookie
 * 清除绑定的网易云 Cookie
 */
app.post("/api/netease/clear-cookie", authMiddleware, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { cookie: null }
    });
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "clear_failed" });
  }
});

// ==================== SoundCloud OAuth 相关 API ====================

/**
 * 解析 SoundCloud 歌单 URL 为 playlist ID
 */
async function resolveSoundCloudPlaylistId(
  input: string,
  user?: { soundcloudToken?: string | null }
): Promise<{
  success: true;
  playlistId: string;
  name: string;
} | {
  success: false;
  error: string;
  message: string;
}> {
  try {
    let accessToken: string | undefined;
    if (user?.soundcloudToken) {
      accessToken = decryptCookie(user.soundcloudToken);
    }

    const provider = new SoundCloudProvider(accessToken);
    const playlistId = await provider.resolvePlaylistUrl(input);
    const meta = await provider.fetchPlaylistMeta(playlistId);

    return {
      success: true,
      playlistId,
      name: meta.name
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (message === "not_a_playlist") {
      return {
        success: false,
        error: "not_a_playlist",
        message: "该链接不是歌单，可能是单曲或用户主页"
      };
    }
    if (message === "private_playlist_unauthorized") {
      return {
        success: false,
        error: "private_playlist_unauthorized",
        message: "该歌单为私密歌单，请先绑定 SoundCloud 账号"
      };
    }

    return {
      success: false,
      error: "invalid_url",
      message: "无法访问该歌单，请检查链接是否正确"
    };
  }
}

/**
 * POST /api/soundcloud/bind
 * 发起 SoundCloud OAuth 绑定（返回授权 URL，前端负责跳转）
 */
app.post("/api/soundcloud/bind", authMiddleware, async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { url, state, verifier } = getAuthorizationUrl(req.userId);
  await storeOAuthState(req.userId, state, verifier);

  res.json({ url });
});

/**
 * GET /api/soundcloud/callback
 * OAuth 回调处理
 */
app.get("/api/soundcloud/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    return res.redirect("/?error=oauth_failed");
  }

  const stateData = await verifyOAuthState(state);
  if (!stateData) {
    return res.redirect("/?error=state_invalid");
  }

  try {
    const tokens = await exchangeCodeForToken(code, stateData.verifier);
    let username = "Unknown";
    try {
      username = await getSoundCloudUser(tokens.accessToken);
    } catch {
      // User info fetch failed, continue with default username
    }

    await storeToken(stateData.userId, tokens.accessToken, tokens.refreshToken, username);
    await deleteOAuthState(state);

    res.redirect("/?soundcloud_bound=1");
  } catch (error) {
    res.redirect("/?error=oauth_failed");
  }
});

/**
 * GET /api/soundcloud/status
 * 查询 SoundCloud 绑定状态
 */
app.get("/api/soundcloud/status", authMiddleware, async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { soundcloudToken: true, soundcloudUsername: true }
  });

  if (!user || !user.soundcloudToken) {
    return res.json({ bound: false });
  }

  return res.json({
    bound: true,
    username: user.soundcloudUsername || "Unknown"
  });
});

/**
 * POST /api/soundcloud/unbind
 * 解绑 SoundCloud 账号
 */
app.post("/api/soundcloud/unbind", authMiddleware, async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  await prisma.user.update({
    where: { id: req.userId },
    data: {
      soundcloudToken: null,
      soundcloudRefreshToken: null,
      soundcloudUsername: null
    }
  });

  res.json({ ok: true });
});

// ==================== 混音任务相关 API ====================

/**
 * POST /api/mix
 * 提交混音任务
 */
app.post("/api/mix", authMiddleware, async (req, res) => {
  try {
    if (!req.userId || !req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const payload = mixRequestSchema.parse(req.body);

    if (payload.weights && payload.weights.length !== payload.sourceUrls.length) {
      return res.status(400).json({ error: "weights_invalid" });
    }

    const outputPlatform = payload.outputPlatform ?? "netease";

    // Check output platform binding
    if (outputPlatform === "netease" && !req.user.cookie) {
      return res.status(403).json({ error: "netease_not_bound" });
    }
    if (outputPlatform === "soundcloud" && !req.user.soundcloudToken) {
      return res.status(403).json({ error: "soundcloud_not_bound" });
    }

    const sourceIds: string[] = [];
    const sourcePlatforms: string[] = [];
    const sourceNames: string[] = [];
    const sourceWeights: (number | null)[] = [];
    const seenIds = new Set<string>();

    for (let index = 0; index < payload.sourceUrls.length; index += 1) {
      const input = payload.sourceUrls[index];

      // Step 1: Identify platform
      const platform = identifyPlatform(input);
      if (!platform) {
        return res.status(400).json({
          error: "unsupported_platform",
          details: {
            inputIndex: index,
            originalInput: truncateInput(input),
            message: `第${index + 1}个歌单链接：不支持该平台，请使用网易云或 SoundCloud 歌单链接`
          }
        });
      }

      // Step 2: Resolve by platform
      let resolvedId: string;
      let name = "";

      if (platform === "netease") {
        const result = await resolvePlaylistId(input);

        if (!result.success) {
          const error = result.error as UrlExtractionError;
          const errorPrefix = index === 0 ? "第1个歌单链接" : `第${index + 1}个歌单链接`;

          return res.status(400).json({
            error: `source_url_${error.code}`,
            details: {
              inputIndex: index,
              originalInput: truncateInput(error.originalInput),
              message: `${errorPrefix}${error.code === 'multiple' ? '有误：' : '：'}${error.message}`
            }
          });
        }

        resolvedId = result.id!;
      } else {
        // SoundCloud
        const result = await resolveSoundCloudPlaylistId(input, req.user);
        if (!result.success) {
          return res.status(400).json({
            error: result.error,
            details: {
              inputIndex: index,
              originalInput: truncateInput(input),
              message: `第${index + 1}个歌单链接：${result.message}`
            }
          });
        }
        resolvedId = result.playlistId;
        name = result.name;
      }

      // Step 3: Check duplicate (with platform prefix)
      const uniqueKey = `${platform}:${resolvedId}`;
      if (seenIds.has(uniqueKey)) {
        return res.status(400).json({
          error: "source_url_duplicate",
          details: {
            inputIndex: index,
            originalInput: truncateInput(input),
            message: `第${index + 1}个歌单链接：该歌单已在列表中，请勿重复添加`
          }
        });
      }

      seenIds.add(uniqueKey);
      sourceIds.push(resolvedId);
      sourcePlatforms.push(platform);
      sourceNames.push(name);
      sourceWeights.push(payload.weights ? payload.weights[index] : null);
    }

    if (sourceIds.length < 2 || sourceIds.length > 10) {
      return res.status(400).json({ error: "sourceUrls_invalid" });
    }

    const normalizedWeights = payload.weights
      ? normalizeWeights(sourceWeights, sourceIds.length)
      : null;

    const taskId = randomUUID();
    await prisma.task.create({
      data: {
        id: taskId,
        ownerId: req.userId,
        status: "Pending",
        progress: 0,
        configJson: JSON.stringify({
          maxTotalDuration: payload.maxTotalDuration,
          sourceIds,
          sourcePlatforms,
          sourceNames,
          weights: normalizedWeights ?? undefined,
          outputPlatform
        })
      }
    });

    await enqueueMixTask(taskId);

    return res.json({ taskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad_request";
    if (message === "weights_invalid") {
      return res.status(400).json({ error: "weights_invalid" });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "bad_request" });
    }
    return res.status(400).json({ error: "bad_request" });
  }
});

/**
 * GET /api/task/:id
 * 查询任务进度
 */
app.get("/api/task/:id", authMiddleware, async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const task = await prisma.task.findUnique({
    where: { id: taskId }
  });

  if (!task) {
    return res.status(404).json({ error: "not_found" });
  }

  // 验证任务所有权
  if (task.ownerId !== req.userId) {
    return res.status(403).json({ error: "forbidden" });
  }

  const distribution = task.distributionJson
    ? JSON.parse(task.distributionJson)
    : null;

  const config = JSON.parse(task.configJson || "{}") as {
    skipStats?: Array<{ sourceName: string; skippedCount: number; reason: string }>;
  };

  return res.json({
    id: task.id,
    status: task.status,
    progress: task.progress,
    resultUrl: task.resultUrl,
    errorMessage: task.errorMessage,
    actualTotalDuration: task.actualTotalDuration,
    distribution,
    skipStats: config.skipStats || []
  });
});

/**
 * GET /api/tasks
 * 获取当前用户的所有任务
 */
app.get("/api/tasks", authMiddleware, async (req, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const tasks = await prisma.task.findMany({
    where: { ownerId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return res.json({
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      progress: task.progress,
      resultUrl: task.resultUrl,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt
    }))
  });
});

// ==================== 系统相关 API ====================

/**
 * GET /api/health
 * 健康检查
 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * GET /api/diagnose
 * 诊断接口
 */
app.get("/api/diagnose", async (_req, res) => {
  const music = await checkUrl("https://music.163.com");
  const short = await checkUrl("https://163cn.tv");
  res.json({ music, short });
});

/**
 * 兜底路由
 */
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// 启动服务器
const port = Number(process.env.PORT ?? 3000);

// 启动定时清理任务
startCleanupScheduler();

app.listen(port, () => {
  process.stdout.write(`Server running on http://localhost:${port}\n`);
});