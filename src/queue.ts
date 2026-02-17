import { Queue } from "bullmq";
import { processMixTask } from "./mixJob";

// 读取环境变量，确定使用哪种队列模式。默认使用 Redis，如果没有配置则使用内存模式。
const queueMode = process.env.QUEUE_MODE ?? "redis";
// 读取 Redis 连接地址
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

/**
 * Redis 连接配置
 * 
 * 作用：如果模式是 redis，则解析 URL 并生成 BullMQ 需要的连接对象。
 * 如果不是 redis 模式，则为 null。
 */
export const connectionOptions =
  queueMode === "redis"
    ? {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        maxRetriesPerRequest: null // BullMQ 要求必须设置为 null
      }
    : null;

/**
 * 创建任务队列实例
 * 
 * 作用：这是任务的“传送带”。如果我们连接了 Redis，就创建一个名为 "mix" 的真实队列。
 * 如果没有 Redis，这个变量就是 null，我们会用另一种方式处理任务。
 */
const mixQueue = connectionOptions
  ? new Queue("mix", { connection: connectionOptions })
  : null;

/**
 * 将混音任务加入队列
 * @param taskId 任务的唯一 ID
 * 
 * 作用：这是生产者 (Producer) 的入口。
 * 当用户发起请求时，我们调用这个函数，把任务 ID 扔进队列里，然后就可以立即给用户返回响应了。
 * 
 * 双模式逻辑：
 * 1. 如果有 mixQueue (Redis 模式)：把任务添加到 Redis 中，等待 Worker 进程去抢。
 * 2. 如果没有 mixQueue (内存模式)：使用 setImmediate 立即在当前进程中异步执行。
 *    这种方式适合开发测试，不需要安装 Redis，但在生产环境可能会因为重启导致任务丢失。
 */
export const enqueueMixTask = async (taskId: string) => {
  if (mixQueue) {
    // Redis 模式：推送到队列
    await mixQueue.add("mix", { taskId });
    return;
  }
  
  // 内存模式：直接在下一轮事件循环中执行
  // 这样不会阻塞当前的 HTTP 请求响应
  setImmediate(() => {
    processMixTask(taskId);
  });
};
