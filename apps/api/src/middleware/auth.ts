import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";

export interface AuthContext {
  tenantId: string;
  userId: string;
  role: "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantSlug = String(req.header("x-tenant-slug") ?? "acme-support");
  const userEmail = String(req.header("x-user-email") ?? "agent@acme.test");

  const user = await prisma.user.findFirst({
    where: { email: userEmail, tenant: { slug: tenantSlug }, active: true },
    select: { id: true, email: true, role: true, tenantId: true }
  });

  if (!user) {
    res.status(401).json({ error: "Unknown tenant or user. Seed the database or send valid auth headers." });
    return;
  }

  req.auth = {
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    email: user.email
  };

  next();
}

export function requireRole(roles: AuthContext["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
