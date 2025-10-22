// server/src/routes/hms/patients.search.ts
import { Router } from "express";
import prisma from "../../lib/prisma";

const router = Router();

/**
 * GET /api/hms/patients/search?q=&tenantId=&limit=
 * - q: query (name/phone/uhid)
 * - tenantId: tenant uuid (in prod, derive from auth)
 */
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const tenantId = String(req.query.tenantId || "").trim();
    const limit = Math.min(Number(req.query.limit || 10), 100);

    if (!q || !tenantId) return res.status(400).json({ error: "q and tenantId required" });

    const phoneCandidate = q.replace(/\s+/g, "");
    const phoneRegex = /^[+\d]{6,20}$/;

    if (phoneRegex.test(phoneCandidate)) {
      const phoneMatch = await prisma.hmsPatient.findFirst({
        where: { tenantId, phone: phoneCandidate },
      });
      if (phoneMatch) return res.json({ results: [phoneMatch] });
    }

    // raw SQL to use pg_trgm similarity
    const results = await prisma.$queryRawUnsafe(
      `
      SELECT id, "tenantId", uhid, "firstName", "lastName", phone, email, meta, "createdAt", "updatedAt"
      FROM "HmsPatient"
      WHERE "tenantId" = $2
        AND ( ("firstName" || ' ' || COALESCE("lastName",'') ) ILIKE '%' || $1 || '%'
           OR ("firstName" || ' ' || COALESCE("lastName",'') ) % $1
           OR phone = $1
           OR uhid = $1
           )
      ORDER BY similarity( ("firstName" || ' ' || COALESCE("lastName",'')) , $1) DESC, "updatedAt" DESC
      LIMIT $3
      `,
      q,
      tenantId,
      limit
    );

    return res.json({ results });
  } catch (err) {
    console.error("search error", err);
    return res.status(500).json({ error: "search failed" });
  }
});

export default router;
