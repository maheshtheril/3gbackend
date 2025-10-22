// server/src/routes/companies.ts
import { Router } from "express";
import { pool } from "../../db";
import requireSession from "../../middleware/requireSession";

const router = Router();
router.use(requireSession);

// same helper you've been using: reads tenant from session or header and sets app.tenant_id
const TENANT_UUID_SQL = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

async function setTenantOn(conn: any, req: any) {
  const tid = String(req.session?.tenant_id || req.headers["x-tenant-id"] || "").trim();
  if (!tid) throw Object.assign(new Error("tenant_id_required"), { status: 400 });
  await conn.query(`select set_config('app.tenant_id', $1, false)`, [tid]);
}

/**
 * Tenant-scoped CRUD for companies
 * - GET    /        -> list companies (tenant-scoped)
 * - POST   /        -> create company (tenant-scoped)
 * - GET    /:id     -> get single company (tenant-scoped)
 * - PUT    /:id     -> update company (tenant-scoped)
 * - DELETE /:id     -> delete company (tenant-scoped)
 *
 * NOTE: Router assumes it's mounted at /api/companies (or similar) in your main app.
 */

router.get("/", async (req: any, res: any, next: any) => {
  const cx = await pool.connect();
  try {
    await setTenantOn(cx, req);

    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);

    const params: any[] = [];
    let idx = 1;
    let where = `WHERE tenant_id = ${TENANT_UUID_SQL}`;

    if (q) {
      where += ` AND name ILIKE $${idx}`;
      params.push(`%${q}%`);
      idx++;
    }

    // return a small set of fields commonly used by UI
    const sql = `
      SELECT id, name, email, phone, website, status, created_at
      FROM public.company
      ${where}
      ORDER BY name ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const { rows } = await cx.query(sql, params);
    res.json({ items: rows });
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  } finally {
    cx.release();
  }
});

router.post("/", async (req: any, res: any, next: any) => {
  const cx = await pool.connect();
  try {
    await setTenantOn(cx, req);

    const { name, email, phone, website, status } = req.body || {};

    if (!name || String(name).trim().length < 1) {
      return res.status(400).json({ message: "name_required" });
    }

    const insertSql = `
      INSERT INTO public.company (tenant_id, name, email, phone, website, status)
      VALUES (${TENANT_UUID_SQL}, $1, $2, $3, $4, $5)
      RETURNING id, name, email, phone, website, status, created_at
    `;

    const params = [String(name).trim(), email || null, phone || null, website || null, status || null];
    const { rows } = await cx.query(insertSql, params);

    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  } finally {
    cx.release();
  }
});

router.get("/:id", async (req: any, res: any, next: any) => {
  const cx = await pool.connect();
  try {
    await setTenantOn(cx, req);

    const { id } = req.params;
    const sql = `
      SELECT id, name, email, phone, website, status, created_at
      FROM public.company
      WHERE tenant_id = ${TENANT_UUID_SQL} AND id = $1
      LIMIT 1
    `;
    const { rows } = await cx.query(sql, [id]);
    if (!rows[0]) return res.status(404).json({ message: "not_found" });
    res.json(rows[0]);
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  } finally {
    cx.release();
  }
});

router.put("/:id", async (req: any, res: any, next: any) => {
  const cx = await pool.connect();
  try {
    await setTenantOn(cx, req);

    const { id } = req.params;
    const { name, email, phone, website, status } = req.body || {};

    if (!name || String(name).trim().length < 1) {
      return res.status(400).json({ message: "name_required" });
    }

    const updateSql = `
      UPDATE public.company
      SET name = $1, email = $2, phone = $3, website = $4, status = $5
      WHERE tenant_id = ${TENANT_UUID_SQL} AND id = $6
      RETURNING id, name, email, phone, website, status, created_at
    `;

    const params = [String(name).trim(), email || null, phone || null, website || null, status || null, id];
    const { rows } = await cx.query(updateSql, params);

    if (!rows[0]) return res.status(404).json({ message: "not_found_or_no_permission" });
    res.json(rows[0]);
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  } finally {
    cx.release();
  }
});

router.delete("/:id", async (req: any, res: any, next: any) => {
  const cx = await pool.connect();
  try {
    await setTenantOn(cx, req);

    const { id } = req.params;
    const deleteSql = `
      DELETE FROM public.company
      WHERE tenant_id = ${TENANT_UUID_SQL} AND id = $1
      RETURNING id
    `;
    const { rows } = await cx.query(deleteSql, [id]);
    if (!rows[0]) return res.status(404).json({ message: "not_found_or_no_permission" });
    res.json({ success: true });
  } catch (e: any) {
    if (e?.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  } finally {
    cx.release();
  }
});

export default router;
