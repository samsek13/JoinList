import "dotenv/config";
import { prisma } from "./db";

async function listPendingUsers() {
  const users = await prisma.user.findMany({
    where: { isApproved: false },
    select: { username: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });

  if (users.length === 0) {
    console.log("没有待批准的用户");
    return;
  }

  console.log(`待批准用户 (${users.length} 个):\n`);
  users.forEach((u, i) => {
    console.log(`${i + 1}. ${u.username}${u.email ? ` (${u.email})` : ""} - 注册于 ${u.createdAt.toLocaleString()}`);
  });
}

listPendingUsers().catch(console.error).finally(() => prisma.$disconnect());
