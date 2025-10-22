// server/src/routes/hms/patients.create.ts
import { Router } from "express";
import prisma from "../../lib/prisma";

const router = Router();

/**
 * POST /api/hms/patients/create
 * body: { tenantId, uhid?, firstName, lastName?, phone?, email?, gender?, dob?, address?, meta?, createdBy? }
 */
router.post("/create", async (req, res) => {
  try {
    const body = req.body;
    const {
      tenantId,
      uhid,
      firstName,
      lastName,
      phone,
      email,
      gender,
      dob,
      address,
      meta,
      createdBy,
    } = body;

    if (!tenantId || !firstName) return res.status(400).json({ error: "tenantId and firstName required" });

    if (uhid) {
      const existing = await prisma.hmsPatient.findFirst({ where: { tenantId, uhid } });
      if (existing) return res.status(200).json({ message: "exists", patient: existing });
    }

    if (phone) {
      const existing = await prisma.hmsPatient.findFirst({ where: { tenantId, phone } });
      if (existing) return res.status(200).json({ message: "exists", patient: existing });
    }

    const created = await prisma.hmsPatient.create({
      data: {
        tenantId,
        uhid: uhid || undefined,
        firstName,
        lastName: lastName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        gender: gender || undefined,
        dob: dob ? new Date(dob) : undefined,
        address: address || undefined,
        meta: meta || undefined,
        createdBy: createdBy || undefined,
      },
    });

    return res.status(201).json({ patient: created });
  } catch (err: any) {
    console.error("create patient error", err);
    if (String(err.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({ error: "duplicate" });
    }
    return res.status(500).json({ error: "create failed" });
  }
});

export default router;
