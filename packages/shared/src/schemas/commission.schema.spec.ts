import { CreateCommissionSchema, UpdateCommissionSchema } from './commission.schema';

describe('comisión del contrato: honorario por gestión de reparaciones', () => {
  const base = { type: 'FixedPercent', percentage: '7' };

  it('es opcional, admite un porcentaje de 0 a 100 o null', () => {
    expect(CreateCommissionSchema.parse(base).repairMgmtFeePct).toBeUndefined();
    expect(CreateCommissionSchema.parse({ ...base, repairMgmtFeePct: '10' }).repairMgmtFeePct).toBe('10');
    expect(CreateCommissionSchema.parse({ ...base, repairMgmtFeePct: 12.5 }).repairMgmtFeePct).toBe('12.5');
    expect(CreateCommissionSchema.parse({ ...base, repairMgmtFeePct: null }).repairMgmtFeePct).toBeNull();
    expect(UpdateCommissionSchema.parse({ repairMgmtFeePct: '0' }).repairMgmtFeePct).toBe('0');
  });

  it('rechaza más de 100, negativos y más de dos decimales', () => {
    for (const bad of ['101', '-1', '10.123', 'diez']) {
      expect(CreateCommissionSchema.safeParse({ ...base, repairMgmtFeePct: bad }).success).toBe(false);
    }
  });
});
