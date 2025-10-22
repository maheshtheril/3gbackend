// server/src/routes/appointments.ts
import express, { Request, Response } from "express";
import prisma from "../lib/prisma"; // adjust path if your tsconfig paths differ
import { z } from "zod";

const router = express.Router();

/**
 * GET /api/appointments
 * Query: tenantId (required), date (optional: YYYY-MM-DD)
 * Returns appointments for the date (or today if missing)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.query.tenantId || "");
    const dateQ = String(req.query.date || "");

    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    const dayStart = dateQ ? new Date(`${dateQ}T00:00:00Z`) : (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayStart.getUTCDate() + 1);

    const appts = await prisma.hmsAppointment.findMany({
      where: {
        tenantId,
        scheduledAt: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      include: { patient: true, doctor: true, createdBy: true },
      orderBy: { scheduledAt: "asc" },
    });

    return res.json({ data: appts });
  } catch (err) {
    console.error("GET /api/appointments error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/appointments
 * Body: { tenantId, patientId, doctorId, scheduledAt (ISO string), reason? }
 * Creates appointment if slot free (exact match) for that doctor.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      tenantId: z.string().min(1),
      patientId: z.string().min(1),
      doctorId: z.string().min(1),
      scheduledAt: z.string().min(1),
      reason: z.string().optional(),
      createdById: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.errors });

    const { tenantId, patientId, doctorId, scheduledAt, reason, createdById } = parsed.data;
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ error: "invalid_date" });

    // Basic conflict check: exact-time collisions for the same doctor (non-cancelled)
    const conflict = await prisma.hmsAppointment.findFirst({
      where: {
        tenantId,
        doctorId,
        scheduledAt: scheduledDate,
        status: { not: "cancelled" },
      },
    });

    if (conflict) {
      return res.status(409).json({ error: "time_slot_taken", conflict });
    }

    const appt = await prisma.hmsAppointment.create({
      data: {
        tenantId,
        patientId,
        doctorId,
        scheduledAt: scheduledDate,
        reason: reason || null,
        createdById: createdById || null,
      },
      include: { patient: true, doctor: true },
    });

    return res.status(201).json({ data: appt });
  } catch (err) {
    console.error("POST /api/appointments error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PATCH /api/appointments/:id/status
 * Body: { status }  // appointment status transitions: scheduled, confirmed, cancelled, completed, no_show
 */
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;
    if (!id || !status) return res.status(400).json({ error: "id_and_status_required" });

    const allowed = ["scheduled", "confirmed", "cancelled", "completed", "no_show"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "invalid_status" });

    const updated = await prisma.hmsAppointment.update({
      where: { id },
      data: {
        status,
        cancelledAt: status === "cancelled" ? new Date() : undefined,
      },
      include: { patient: true, doctor: true },
    });

    return res.json({ data: updated });
  } catch (err: any) {
    console.error("PATCH /api/appointments/:id/status error", err);
    if (err.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
