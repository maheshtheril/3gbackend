// server/src/routes/public-invoice.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

const JWT_KEY = process.env.JWT_SIGNING_KEY || 'replace-me';

function verifyInvoiceToken(token: string | undefined) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_KEY) as { invoiceId: string, tenantId: string, iat:number, exp:number };
  } catch (e) {
    return null;
  }
}

function escapeHtml(str: any) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

router.get('/public/invoices/view', async (req, res) => {
  const token = String(req.query.token || '');
  const payload = verifyInvoiceToken(token);
  if (!payload) return res.status(403).send('Invalid or expired link');

  const inv = await prisma.hmsInvoice.findUnique({ where: { id: payload.invoiceId }, include: { items: true, patient: true }});
  if (!inv) return res.status(404).send('Invoice not found');

  const patient = inv.patient;
  const rows = (inv.items || []).map(it => `
    <tr>
      <td>${escapeHtml(it.description)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">${Number(it.rate).toFixed(2)}</td>
      <td style="text-align:right">${Number(it.amount).toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:Arial;font-size:14px;color:#222}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #eee}</style>
    <title>Invoice ${inv.invoiceNo}</title></head><body>
    <h2>Hospital Name</h2>
    <div><strong>Invoice:</strong> ${inv.invoiceNo} &nbsp; <strong>Date:</strong> ${new Date(inv.createdAt).toLocaleString()}</div>
    <hr/>
    <div><strong>Patient:</strong> ${escapeHtml(patient?.firstName || '')} ${escapeHtml(patient?.lastName || '')} <br/>Phone: ${escapeHtml(patient?.phone || '-')}</div>
    <table aria-hidden="true"><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="text-align:right;margin-top:12px"><div>Subtotal: ${Number(inv.subtotal).toFixed(2)}</div><div>Discount: ${Number(inv.discount).toFixed(2)}</div><div>Tax: ${Number(inv.tax).toFixed(2)}</div><div style="font-weight:700">TOTAL: ${Number(inv.total).toFixed(2)}</div></div>
    <hr/><div>Download / print this page from your phone browser.</div></body></html>`;

  res.send(html);
});

export default router;
