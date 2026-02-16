import { Queue } from "bullmq";
import { processMixTask } from "./mixJob";

const queueMode = process.env.QUEUE_MODE ?? "redis";
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

export const connectionOptions =
  queueMode === "redis"
    ? {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        maxRetriesPerRequest: null
      }
    : null;

const mixQueue = connectionOptions
  ? new Queue("mix", { connection: connectionOptions })
  : null;

export const enqueueMixTask = async (taskId: string) => {
  if (mixQueue) {
    await mixQueue.add("mix", { taskId });
    return;
  }
  setImmediate(() => {
    processMixTask(taskId);
  });
};
