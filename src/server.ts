import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "./db";
import { enqueueMixTask } from "./queue";
import { hashCookie, resolvePlaylistIds } from "./utils";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

const mixRequestSchema = z.object({
  cookie: z.string().min(10),
  sourceUrls: z.array(z.string().min(1)).min(2).max(10),
  maxTotalDuration: z.number().int().positive()
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

app.post("/api/mix", async (req, res) => {
  try {
    const payload = mixRequestSchema.parse(req.body);
    
    // Normalize cookie: if user pasted just the value of MUSIC_U (no key), fix it
    let cookie = payload.cookie.trim();
    if (!cookie.includes("=") && cookie.length > 20) {
      cookie = `MUSIC_U=${cookie}`;
    }

    const sourceIds = await resolvePlaylistIds(payload.sourceUrls);
    if (sourceIds.length < 2 || sourceIds.length > 10) {
      return res.status(400).json({ error: "sourceUrls_invalid" });
    }
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
        cookie: cookie,
        lastLoginTime: new Date()
      }
    });

    const taskId = randomUUID();
    await prisma.task.create({
      data: {
        id: taskId,
        ownerId: userId,
        status: "Pending",
        progress: 0,
        configJson: JSON.stringify({
          maxTotalDuration: payload.maxTotalDuration,
          sourceIds,
          cookie // Pass normalized cookie to task config if needed
        })
      }
    });

    await enqueueMixTask(taskId);

    return res.json({ taskId });
  } catch (_error) {
    return res.status(400).json({ error: "bad_request" });
  }
});

app.get("/api/task/:id", async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id }
  });
  if (!task) {
    return res.status(404).json({ error: "not_found" });
  }
  const distribution = task.distributionJson
    ? JSON.parse(task.distributionJson)
    : null;
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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/diagnose", async (_req, res) => {
  const music = await checkUrl("https://music.163.com");
  const short = await checkUrl("https://163cn.tv");
  res.json({ music, short });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  process.stdout.write(`Server running on http://localhost:${port}\n`);
});
