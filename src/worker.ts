import "dotenv/config";
import { Worker } from "bullmq";
import { connectionOptions } from "./queue";
import { processMixTask } from "./mixJob";

/**
 * Worker 进程入口
 * 
 * 作用：这是后台“工人”。它的工作是从队列里抢任务，然后埋头苦干。
 * 在生产环境中，我们通常会启动多个 Worker 进程来并行处理任务。
 */
if (connectionOptions) {
  // 如果配置了 Redis，就启动 BullMQ 的 Worker
  new Worker(
    "mix", // 监听名为 "mix" 的队列
    async (job) => {
      // 收到任务后，调用处理函数
      // job.data 包含了我们在 enqueueMixTask 时放入的数据
      await processMixTask(job.data.taskId as string);
    },
    { connection: connectionOptions }
  );
  process.stdout.write("Worker started\n");
} else {
  // 如果没有 Redis，Worker 不需要启动，因为任务会在 server 进程里直接处理
  process.stdout.write("Worker disabled with in-memory queue\n");
}
