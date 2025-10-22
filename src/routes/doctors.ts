// server/src/routes/doctors.ts
import express, { Request, Response } from "express";
import prisma from "../lib/prisma";

const router = express.Router();

// GET /api/doctors?tenantId=...
router.get("/", async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.query.tenantId || "");
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    const doctors = await prisma.hmsDoctor.findMany({
      where: { tenantId },
      take: 100,
      orderBy: { firstName: "asc" },
    });

    return res.json({ data: doctors });
  } catch (err) {
    console.error("GET /api/doctors error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
