// server/src/routes/hms.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import Twilio from 'twilio';

const router = express.Router();
const prisma = new PrismaClient();

// env
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const JWT_KEY = process.env.JWT_SIGNING_KEY || 'replace-me';
const JWT_EXP = Number(process.env.JWT_EXP_SECONDS || 3600);
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_WHATSAPP_FROM;

const twClient = (TW_SID && TW_TOKEN) ? Twilio(TW_SID, TW_TOKEN) : null;

// helper: sign token for public invoice link
function signInvoiceToken(payload: { invoiceId: string; tenantId: string }) {
  return jwt.sign(payload, JWT_KEY, { expiresIn: JWT_EXP });
}

// ---------- POST /hms/invoices
router.post('/hms/invoices', async (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.tenantId || !body.patientId || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    // compute totals
    let subtotal = 0;
    const items = body.items.map((it: any) => {
      const qty = Number(it.qty || 1);
      const rate = Number(it.rate || 0);
      const amount = qty * rate;
      subtotal += amount;
      return {
        id: undefined, // prisma will generate id
        description: it.description || (it.serviceId ? 'Service' : 'Item'),
        serviceId: it.serviceId || null,
        qty,
        rate,
        amount,
      };
    });

    const discount = Number(body.discount || 0);
    const tax = Number(body.tax || 0);
    const total = subtotal - discount + tax;

    const invoiceNo = `INV-${new Date().toISOString().slice(0,10)}-${Math.floor(Math.random()*9000)+1000}`;

    // create invoice and items
    const invoice = await prisma.hmsInvoice.create({
      data: {
        tenantId: body.tenantId,
        patientId: body.patientId,
        invoiceNo,
        subtotal: subtotal,
        discount,
        tax,
        total,
        items: { create: items.map(it => ({ description: it.description, serviceId: it.serviceId, qty: it.qty, rate: it.rate, amount: it.amount })) },
      },
      include: { items: true },
    });

    // create simple accounting entries
    await prisma.hmsAccountingEntry.createMany({
      data: [
        { tenantId: body.tenantId, invoiceId: invoice.id, account: 'Accounts Receivable', debit: Number(total), credit: 0 },
        { tenantId: body.tenantId, invoiceId: invoice.id, account: 'Service Revenue', debit: 0, credit: Number(subtotal - discount) },
      ],
    });

    return res.json(invoice);
  } catch (err: any) {
    console.error('create-invoice err', err);
    return res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});

// ---------- POST /hms/invoices/:id/payments
router.post('/hms/invoices/:id/payments', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { tenantId, amount, mode, reference } = req.body;
    if (!invoiceId || !tenantId || !amount) return res.status(400).json({ error: 'invalid_payload' });

    const invoice = await prisma.hmsInvoice.findUnique({ where: { id: invoiceId }});
    if (!invoice) return res.status(404).json({ error: 'invoice_not_found' });

    const payment = await prisma.hmsPayment.create({
      data: {
        tenantId,
        invoiceId,
        amount: Number(amount),
        mode: mode || 'OTHER',
        reference: reference || null,
      }
    });

    // accounting entries for payment
    await prisma.hmsAccountingEntry.createMany({
      data: [
        { tenantId, paymentId: payment.id, account: mode === 'CASH' ? 'Cash' : 'Bank', debit: Number(amount), credit: 0 },
        { tenantId, paymentId: payment.id, account: 'Accounts Receivable', debit: 0, credit: Number(amount) },
      ],
    });

    // update invoice status
    const paidSumObj = await prisma.hmsPayment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
    const paidSum = Number(paidSumObj._sum?.amount || 0);

    let status = 'UNPAID';
    if (paidSum >= Number(invoice.total)) status = 'PAID';
    else if (paidSum > 0) status = 'PARTIAL';

    await prisma.hmsInvoice.update({ where: { id: invoiceId }, data: { status } });

    return res.json(payment);
  } catch (err: any) {
    console.error('record-payment err', err);
    return res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});

// ---------- POST /hms/invoices/:id/send-whatsapp
router.post('/hms/invoices/:id/send-whatsapp', async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { tenantId } = req.body;
    if (!invoiceId || !tenantId) return res.status(400).json({ error: 'invalid_payload' });

    const invoice = await prisma.hmsInvoice.findUnique({ where: { id: invoiceId }, include: { patient: true }});
    if (!invoice) return res.status(404).json({ error: 'invoice_not_found' });

    const phone = invoice.patient?.phone;
    if (!phone) {
      // create log and return
      await prisma.hmsMessageLog.create({
        data: { tenantId, invoiceId, channel: 'WHATSAPP', to: '', provider: 'TWILIO', status: 'FAILED', error: 'missing_phone' }
      });
      return res.status(400).json({ error: 'missing_patient_phone' });
    }

    // generate token + link
    const token = signInvoiceToken({ invoiceId: invoice.id, tenantId });
    const link = `${BASE_URL}/public/invoices/view?token=${token}`;

    const log = await prisma.hmsMessageLog.create({
      data: { tenantId, patientId: invoice.patient?.id, invoiceId: invoice.id, channel: 'WHATSAPP', to: phone, provider: 'TWILIO', status: 'PENDING' }
    });

    // send via Twilio if configured
    if (twClient && TW_FROM) {
      try {
        const bodyText = `Dear ${invoice.patient?.firstName || ''}, your invoice ${invoice.invoiceNo} is ready. Total: ₹${Number(invoice.total).toFixed(2)}. View: ${link}`;
        const msg = await twClient.messages.create({ from: TW_FROM, to: `whatsapp:${phone}`, body: bodyText });
        await prisma.hmsMessageLog.update({ where: { id: log.id }, data: { status: 'SENT', providerId: msg.sid }});
        return res.json({ ok: true, sid: msg.sid });
      } catch (twErr: any) {
        console.error('twilio err', twErr);
        await prisma.hmsMessageLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: String(twErr.message || twErr) }});
        return res.status(500).json({ ok: false, error: String(twErr.message || twErr) });
      }
    } else {
      // Twilio not configured — mark as failed and return link so you can test manually
      await prisma.hmsMessageLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: 'twilio_not_configured' }});
      return res.json({ ok: false, note: 'twilio_not_configured', link });
    }
  } catch (err: any) {
    console.error('send-whatsapp err', err);
    return res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});

export default router;
