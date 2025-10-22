// server/prisma/seed_hms.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upsertTenantByName(name) {
  const existing = await prisma.hmsTenant.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.hmsTenant.create({ data: { name } });
}

async function main() {
  const tenant = await upsertTenantByName('default_hms_tenant');

  // create patient if not exist
  const patient = await prisma.hmsPatient.findFirst({
    where: { tenantId: tenant.id, uhid: 'UHID-0001' }
  }) || await prisma.hmsPatient.create({
    data: {
      tenantId: tenant.id,
      uhid: 'UHID-0001',
      firstName: 'Walkin',
      lastName: 'Patient',
      phone: '+919999999999'
    }
  });

  // create service if not exist
  const service = await prisma.hmsService.findFirst({
    where: { tenantId: tenant.id, code: 'CONS-001' }
  }) || await prisma.hmsService.create({
    data: {
      tenantId: tenant.id,
      code: 'CONS-001',
      name: 'Consultation Fee',
      rate: 500.00
    }
  });

  console.log('SEED_OK', { tenantId: tenant.id, patientId: patient.id, serviceId: service.id });
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
