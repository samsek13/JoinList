import "dotenv/config";
import { prisma } from "../src/db";

async function main() {
  const users = await prisma.user.findMany({
    select: { username: true, cookie: true, isApproved: true },
    orderBy: { createdAt: "asc" }
  });

  if (!users.length) {
    process.stdout.write("数据库中没有任何用户\n");
  } else {
    process.stdout.write(`共 ${users.length} 个用户:\n`);
    users.forEach((u) => {
      const status = u.isApproved ? "已审批" : "待审批";
      const bound = u.cookie ? "已绑定网易云" : "未绑定网易云";
      process.stdout.write(`  - ${u.username} (${status}, ${bound})\n`);
    });
  }

  await prisma.$disconnect();
}

main();
