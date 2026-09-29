import { Router } from "express";
import { prisma } from "../../db";
import { asyncHandler } from "../../middleware/errors";

export const customerRouter = Router();

customerRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const customers = await prisma.customer.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { company: { name: { contains: search, mode: "insensitive" } } }
              ]
            }
          : {})
      },
      include: {
        company: true,
        _count: { select: { tickets: true } }
      },
      orderBy: { name: "asc" },
      take: 50
    });

    res.json({ items: customers });
  })
);

customerRouter.get(
  "/companies",
  asyncHandler(async (req, res) => {
    const companies = await prisma.company.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { _count: { select: { customers: true } } },
      orderBy: { name: "asc" }
    });
    res.json({ items: companies });
  })
);
