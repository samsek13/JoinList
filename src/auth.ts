import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { prisma } from "./db";

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = "7d";

/**
 * 对密码进行哈希处理
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * 验证密码是否匹配
 */
export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * 生成 JWT 访问令牌
 */
export const generateToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET not configured");
  }
  return jwt.sign({ userId }, secret, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * 验证 JWT 令牌并返回用户 ID
 */
export const verifyToken = (token: string): string | null => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  try {
    const payload = jwt.verify(token, secret) as { userId: string };
    return payload.userId;
  } catch {
    return null;
  }
};

/**
 * 创建用户
 */
export const createUser = async (
  username: string,
  password: string,
  email?: string
) => {
  const userId = randomUUID();
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      id: userId,
      username,
      email: email || null,
      passwordHash,
      lastLoginTime: new Date()
    }
  });

  return user;
};

/**
 * 验证用户登录
 */
export const authenticateUser = async (
  username: string,
  password: string
): Promise<{ user: { id: string; username: string; email: string | null }; token: string } | { error: string } | null> => {
  const user = await prisma.user.findUnique({
    where: { username }
  });

  if (!user) {
    return null;
  }

  // 检查用户是否已批准
  if (!user.isApproved) {
    return { error: "account_pending_approval" };
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  // 更新最后登录时间
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginTime: new Date() }
  });

  const token = generateToken(user.id);

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email
    },
    token
  };
};

/**
 * 通过 ID 获取用户
 */
export const getUserById = async (userId: string) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      cookie: true,
      createdAt: true
    }
  });
};