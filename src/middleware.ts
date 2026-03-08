import { Request, Response, NextFunction } from "express";
import { verifyToken, getUserById } from "./auth";

// 扩展 Express Request 类型
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        username: string;
        email: string | null;
        cookie?: string | null;
        createdAt: Date;
      };
    }
  }
}

/**
 * 认证中间件
 * 验证 JWT 令牌并将用户信息附加到请求对象
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.substring(7);
  const userId = verifyToken(token);

  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const user = await getUserById(userId);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  req.userId = userId;
  req.user = user;
  next();
};

/**
 * 可选认证中间件
 * 如果提供了令牌则验证，但不强制要求
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.substring(7);
  const userId = verifyToken(token);

  if (userId) {
    const user = await getUserById(userId);
    if (user) {
      req.userId = userId;
      req.user = user;
    }
  }

  next();
};