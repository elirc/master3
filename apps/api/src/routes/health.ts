import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/errors";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "reachable" });
  })
);
