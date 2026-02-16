import "dotenv/config";
import { Worker } from "bullmq";
import { connectionOptions } from "./queue";
import { processMixTask } from "./mixJob";

if (connectionOptions) {
  new Worker(
    "mix",
    async (job) => {
      await processMixTask(job.data.taskId as string);
    },
    { connection: connectionOptions }
  );
  process.stdout.write("Worker started\n");
} else {
  process.stdout.write("Worker disabled with in-memory queue\n");
}
