import { Router } from "express";
import { prisma } from "../../db";
import { requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errors";

export const adminRouter = Router();

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.auth!.tenantId },
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    });
    res.json({ items: users });
  })
);

adminRouter.get(
  "/audit-logs",
  requireRole(["ADMIN", "MANAGER"]),
  asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { actor: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json({ items: logs });
  })
);
