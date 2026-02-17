import { PrismaClient } from "@prisma/client";

/**
 * 初始化数据库客户端
 * 
 * 作用：Prisma 是一个 ORM (对象关系映射) 工具，它让我们能用
 * JavaScript 对象的方式操作数据库，而不是写 SQL 语句。
 * 
 * 这里创建了一个全局唯一的 prisma 实例，整个应用都用它来读写数据库。
 * 
 * globalForPrisma 是一种在开发环境下防止因热重载导致创建过多数据库连接的技巧。
 */
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // 如果需要调试数据库操作，可以把下面的 log 打开
    // log: ['query'],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
