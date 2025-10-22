// server/src/routes/patients.ts
import express, { Request, Response } from "express";
import prisma from "../lib/prisma"; // adjust path if your prisma client is elsewhere

const router = express.Router();

/**
 * POST /api/patients
 * Body expected:
 * {
 *   tenantId: string,
 *   uhid?: string,
 *   firstName: string,
 *   lastName: string,
 *   phone?: string,
 *   email?: string,
 *   gender?: "male"|"female"|"other"|"unspecified",
 *   dob?: string | Date,
 *   address?: string,
 *   meta?: any,
 *   createdBy?: string
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Basic required checks (mirror what your leads route probably does)
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ message: "firstName and lastName are required" });
    }
    if (!body.tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    // Normalize DOB
    const dob = body.dob ? new Date(body.dob) : null;

    // Build prisma data object using nested relation connect for type-safety
    const data = {
      uhid: body.uhid ?? undefined,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone ?? null,
      email: body.email ?? null,
      gender: body.gender ?? "unspecified",
      dob: dob ?? null,
      address: body.address ?? null,
      meta: body.meta ?? undefined,
      tenant: { connect: { id: body.tenantId } }, // <-- type-safe
      createdBy: body.createdBy ? { connect: { id: body.createdBy } } : undefined,
    };

    const patient = await prisma.hmsPatient.create({ data });

    return res.status(201).json(patient);
  } catch (err: any) {
    console.error("Create patient error:", err);
    // If Prisma specific error you can inspect err.code etc
    return res.status(500).json({ message: err?.message || "Internal server error" });
  }
});
// append to server/src/routes/patients.ts
// GET /api/patients/search?q=...&tenantId=...
router.get("/search", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    const tenantId = (req.query.tenantId as string);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });

    const items = await prisma.hmsPatient.findMany({
      where: {
        tenantId,
        OR: [
          { phone: { contains: q } },
          { email: { contains: q } },
          { uhid: { contains: q } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    return res.json(items);
  } catch (err: any) {
    console.error("patient search error", err);
    return res.status(500).json({ message: err?.message || "failed" });
  }
});

export default router;
