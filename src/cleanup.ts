import { prisma } from "./db";

/**
 * 清理过期任务记录
 *
 * 删除条件：
 * - status = Completed
 * - createdAt < 30 天前
 *
 * @returns 删除的记录数
 */
export async function cleanupOldTasks(): Promise<number> {
  const RETENTION_DAYS = 30;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const result = await prisma.task.deleteMany({
    where: {
      status: "Completed",
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  console.log(`[Cleanup] Deleted ${result.count} expired task(s)`);
  return result.count;
}

/**
 * 启动定时清理任务
 *
 * 执行时机：
 * - 立即执行一次
 * - 之后每 24 小时执行一次
 *
 * @returns 清理定时器引用（用于测试或优雅关闭）
 */
export function startCleanupScheduler(): NodeJS.Timeout {
  // 启动时立即执行一次
  cleanupOldTasks().catch((err) => {
    console.error("[Cleanup] Initial cleanup failed:", err);
  });

  // 每 24 小时执行一次
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const timer = setInterval(() => {
    cleanupOldTasks().catch((err) => {
      console.error("[Cleanup] Scheduled cleanup failed:", err);
    });
  }, CLEANUP_INTERVAL_MS);

  console.log("[Cleanup] Scheduler started (runs every 24 hours)");
  return timer;
}