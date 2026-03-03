import "dotenv/config";
import { prisma } from "./db";

const username = process.argv[2];

if (!username) {
  console.error("用法: npx tsx src/approve-user.ts <用户名>");
  process.exit(1);
}

async function approveUser() {
  const user = await prisma.user.findUnique({
    where: { username }
  });

  if (!user) {
    console.error(`错误: 用户 "${username}" 不存在`);
    process.exit(1);
  }

  if (user.isApproved) {
    console.log(`用户 "${username}" 已经批准过了`);
    return;
  }

  await prisma.user.update({
    where: { username },
    data: { isApproved: true }
  });

  console.log(`✓ 用户 "${username}" 已批准，现在可以登录了`);
}

approveUser().catch(console.error).finally(() => prisma.$disconnect());
