-- Datos sintéticos con la forma de los reales, para ensayar migraciones.
--
-- Se cargan sobre el esquema ANTERIOR a las migraciones nuevas (el que existe en
-- la rama base), por eso solo usan columnas de ese esquema. Todo es inventado:
-- nombres, documentos, CUIT y CBU son valores obviamente falsos (ceros y
-- secuencias), nada proviene de una persona o una inmobiliaria real.
--
-- Inmobiliaria A (tenant-a): 10 personas con distintas combinaciones de datos
-- bancarios, 3 propiedades, 2 contratos con partes y garantes, liquidaciones,
-- pagos y un comprobante. Inmobiliaria B (tenant-b): lo mínimo para comprobar
-- que ninguna migración mezcla datos entre inmobiliarias.
--
-- Si cambia la forma de los datos, actualizar también checks/*.sql, que
-- verifican los conteos de este archivo.

BEGIN;

INSERT INTO "tenants" ("id", "name", "cuit", "province", "updatedAt") VALUES
  ('tenant-a', 'Inmobiliaria Ficticia A', '30000000001', 'Ciudad de prueba', now()),
  ('tenant-b', 'Inmobiliaria Ficticia B', '30000000002', 'Ciudad de prueba', now());

INSERT INTO "users" ("id", "email", "passwordHash", "firstName", "lastName", "tenantId", "updatedAt") VALUES
  ('user-a', 'admin-a@ejemplo.invalid', 'hash-ficticio', 'Admin', 'Ficticio A', 'tenant-a', now()),
  ('user-b', 'admin-b@ejemplo.invalid', 'hash-ficticio', 'Admin', 'Ficticio B', 'tenant-b', now());

-- Personas. Los datos bancarios viejos cubren todas las combinaciones:
--   p01, p05, p09: banco, CBU y alias        p02: solo CBU
--   p03: solo alias                           p04: solo banco
--   p10: CBU y alias                          p06: cadenas vacías y espacios (no cuenta)
--   p07, p08: sin datos bancarios
INSERT INTO "persons" ("id", "firstName", "lastName", "email", "phone", "cuit", "fiscalCondition", "bankName", "cbu", "bankAlias", "tenantId", "updatedAt") VALUES
  ('p01', 'Persona', 'Uno',    'p01@ejemplo.invalid', '0000-0001', '20000000011', 'Monotributista',      'Banco Ficticio', '0000000000000000000001', 'alias.uno',    'tenant-a', now()),
  ('p02', 'Persona', 'Dos',    'p02@ejemplo.invalid', '0000-0002', '20000000021', 'ResponsableInscripto', NULL,            '0000000000000000000002', NULL,           'tenant-a', now()),
  ('p03', 'Persona', 'Tres',   'p03@ejemplo.invalid', '0000-0003', '20000000031', 'ConsumidorFinal',     NULL,             NULL,                     'alias.tres',   'tenant-a', now()),
  ('p04', 'Persona', 'Cuatro', 'p04@ejemplo.invalid', '0000-0004', NULL,          NULL,                  'Banco Ficticio', NULL,                     NULL,           'tenant-a', now()),
  ('p05', 'Persona', 'Cinco',  'p05@ejemplo.invalid', '0000-0005', '20000000051', 'Monotributista',      'Banco Ejemplo',  '0000000000000000000005', 'alias.cinco',  'tenant-a', now()),
  ('p06', 'Persona', 'Seis',   'p06@ejemplo.invalid', '0000-0006', NULL,          NULL,                  '',               '   ',                    '',             'tenant-a', now()),
  ('p07', 'Persona', 'Siete',  'p07@ejemplo.invalid', '0000-0007', NULL,          NULL,                  NULL,             NULL,                     NULL,           'tenant-a', now()),
  ('p08', 'Persona', 'Ocho',   'p08@ejemplo.invalid', '0000-0008', NULL,          NULL,                  NULL,             NULL,                     NULL,           'tenant-a', now()),
  ('p09', 'Persona', 'Nueve',  'p09@ejemplo.invalid', '0000-0009', '20000000091', 'Exento',              'Banco Ejemplo',  '0000000000000000000009', 'alias.nueve',  'tenant-a', now()),
  ('p10', 'Persona', 'Diez',   'p10@ejemplo.invalid', '0000-0010', '20000000101', 'Monotributista',      NULL,             '0000000000000000000010', 'alias.diez',   'tenant-a', now()),
  ('pb1', 'Persona', 'B Uno',  'pb1@ejemplo.invalid', '0000-0101', '20000000111', 'Monotributista',      'Banco Ficticio', '0000000000000000000101', 'alias.b.uno',  'tenant-b', now()),
  ('pb2', 'Persona', 'B Dos',  'pb2@ejemplo.invalid', '0000-0102', NULL,          NULL,                  NULL,             NULL,                     NULL,           'tenant-b', now());

INSERT INTO "person_role_assignments" ("id", "personId", "role", "tenantId") VALUES
  ('r01', 'p01', 'Propietario', 'tenant-a'),
  ('r05', 'p05', 'Propietario', 'tenant-a'),
  ('r07', 'p07', 'Inquilino',   'tenant-a'),
  ('r08', 'p08', 'Inquilino',   'tenant-a'),
  ('r09', 'p09', 'Garante',     'tenant-a'),
  ('rb1', 'pb1', 'Propietario', 'tenant-b'),
  ('rb2', 'pb2', 'Inquilino',   'tenant-b');

INSERT INTO "properties" ("id", "title", "type", "street", "number", "city", "tenantId", "updatedAt") VALUES
  ('prop-1',  'Departamento de prueba 1', 'Departamento', 'Calle Inventada', '100', 'Ciudad de prueba', 'tenant-a', now()),
  ('prop-2',  'Casa de prueba',           'Casa',         'Calle Inventada', '200', 'Ciudad de prueba', 'tenant-a', now()),
  ('prop-3',  'Edificio de prueba',       'Edificio',     'Calle Inventada', '300', 'Ciudad de prueba', 'tenant-a', now()),
  ('prop-b1', 'Departamento de prueba B', 'Departamento', 'Calle Inventada', '400', 'Ciudad de prueba', 'tenant-b', now());

INSERT INTO "contracts" ("id", "tenantId", "propertyId", "contractType", "status", "startDate", "endDate", "rentAmount", "adjustmentType", "adjustmentPeriod", "updatedAt") VALUES
  ('con-1',  'tenant-a', 'prop-1',  'Alquiler', 'Activo', '2026-01-01', '2028-01-01', 100000.00, 'IPC', 'Trimestral', now()),
  ('con-2',  'tenant-a', 'prop-2',  'Alquiler', 'Activo', '2026-03-01', '2028-03-01', 150000.00, 'ICL', 'Semestral',  now()),
  ('con-b1', 'tenant-b', 'prop-b1', 'Alquiler', 'Activo', '2026-02-01', '2028-02-01',  90000.00, 'IPC', 'Trimestral', now());

INSERT INTO "contract_persons" ("id", "tenantId", "contractId", "personId", "role") VALUES
  ('cp-1',  'tenant-a', 'con-1',  'p01', 'Propietario'),
  ('cp-2',  'tenant-a', 'con-1',  'p07', 'Inquilino'),
  ('cp-3',  'tenant-a', 'con-1',  'p09', 'Garante'),
  ('cp-4',  'tenant-a', 'con-2',  'p05', 'Propietario'),
  ('cp-5',  'tenant-a', 'con-2',  'p08', 'Inquilino'),
  ('cp-6',  'tenant-a', 'con-2',  'p10', 'Garante'),
  ('cp-b1', 'tenant-b', 'con-b1', 'pb1', 'Propietario'),
  ('cp-b2', 'tenant-b', 'con-b1', 'pb2', 'Inquilino');

INSERT INTO "liquidaciones" ("id", "tenantId", "contractId", "period", "dueDate", "subtotal", "total", "updatedAt") VALUES
  ('liq-1',  'tenant-a', 'con-1',  '2026-03-01', '2026-03-10', 100000.00, 100000.00, now()),
  ('liq-2',  'tenant-a', 'con-2',  '2026-03-01', '2026-03-10', 150000.00, 150000.00, now()),
  ('liq-b1', 'tenant-b', 'con-b1', '2026-03-01', '2026-03-10',  90000.00,  90000.00, now());

INSERT INTO "liquidacion_line_items" ("id", "tenantId", "liquidacionId", "type", "description", "amount") VALUES
  ('li-1',  'tenant-a', 'liq-1',  'Alquiler', 'Alquiler marzo', 100000.00),
  ('li-2',  'tenant-a', 'liq-2',  'Alquiler', 'Alquiler marzo', 150000.00),
  ('li-b1', 'tenant-b', 'liq-b1', 'Alquiler', 'Alquiler marzo',  90000.00);

INSERT INTO "payments" ("id", "tenantId", "liquidacionId", "amount", "method", "paidAt") VALUES
  ('pay-1', 'tenant-a', 'liq-1', 100000.00, 'Transferencia', '2026-03-05'),
  ('pay-2', 'tenant-a', 'liq-2',  50000.00, 'Efectivo',      '2026-03-06');

INSERT INTO "arca_issuers" ("id", "tenantId", "cuit", "businessName", "fiscalCondition", "updatedAt") VALUES
  ('iss-a', 'tenant-a', '20000000011', 'Persona Uno', 'Monotributista', now());

INSERT INTO "comprobantes" ("id", "tenantId", "issuerId", "paymentId", "type", "cbteTipo", "puntoDeVenta", "numero", "docTipo", "docNro", "receptorName", "receptorFiscalCondition", "impTotal", "impNeto", "impIva", "impExento", "currency", "cae", "caeFchVto", "emittedAt") VALUES
  ('cmp-1', 'tenant-a', 'iss-a', 'pay-1', 'FacturaC', 11, 1, 1, 96, '00000007', 'Persona Siete', 'ConsumidorFinal', 100000.00, 100000.00, 0, 0, 'ARS', '00000000000000', '2026-04-01', '2026-03-05');

COMMIT;
