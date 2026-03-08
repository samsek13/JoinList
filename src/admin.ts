import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

/**
 * 管理员登录验证
 * 直接比较密码，无需 bcrypt（密码通过环境变量配置）
 */
export function verifyAdminPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("ADMIN_PASSWORD not configured");
  }
  return password === adminPassword;
}

/**
 * 生成管理员 JWT
 * 复用现有的 JWT_SECRET
 * Payload 包含 sub 和 role，预留多角色扩展
 */
export function generateAdminToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET not configured");
  }
  return jwt.sign({ sub: "admin", role: "admin" }, secret, { expiresIn: "7d" });
}

/**
 * 验证管理员 JWT
 * 检查 token 有效性并验证 role 为 admin
 */
export function verifyAdminToken(token: string): { sub: string; role: string } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  try {
    const payload = jwt.verify(token, secret) as { sub: string; role: string };
    if (payload.role !== "admin") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * 管理员认证中间件
 * 验证 Authorization header 中的 Bearer token
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.substring(7);
  const payload = verifyAdminToken(token);

  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}