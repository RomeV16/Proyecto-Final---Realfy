import { PropertyOwnershipsService } from './property-ownerships.service';

const TENANT_ID = 'tenant-1';
const PROPERTY = 'b0000000-0000-4000-8000-000000000001';
const PERSON = 'a0000000-0000-4000-8000-000000000001';

function setup() {
  const client: any = {
    property: { findFirst: jest.fn().mockResolvedValue({ id: PROPERTY }) },
    person: { findFirst: jest.fn().mockResolvedValue({ id: PERSON, tenantId: TENANT_ID }) },
    propertyOwnership: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'o1', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    personRoleAssignment: { upsert: jest.fn().mockResolvedValue({}) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const service = new PropertyOwnershipsService(
    { client } as any,
    { getTenantId: () => TENANT_ID } as any,
  );
  return { client, service };
}

async function errorBody(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err.getResponse();
  }
  throw new Error('se esperaba un rechazo');
}

describe('PropertyOwnershipsService', () => {
  it('registra un titular sin porcentaje y lo etiqueta como propietario', async () => {
    const { client, service } = setup();

    const ownership = await service.create(PROPERTY, { personId: PERSON });

    expect(ownership).toMatchObject({
      tenantId: TENANT_ID,
      propertyId: PROPERTY,
      personId: PERSON,
      sharePct: null,
    });
    expect(client.personRoleAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ personId: PERSON, role: 'Propietario' }),
      }),
    );
  });

  it('no exige que los porcentajes sumen 100', async () => {
    const { client, service } = setup();
    client.propertyOwnership.findMany.mockResolvedValue([{ sharePct: '70' }]);

    await expect(
      service.create(PROPERTY, { personId: PERSON, sharePct: '10.5', title: 'Nuda propiedad' }),
    ).resolves.toMatchObject({ sharePct: '10.5', title: 'Nuda propiedad' });
  });

  it('valida el porcentaje y las fechas', async () => {
    const { service } = setup();

    expect((await errorBody(service.create(PROPERTY, { personId: PERSON, sharePct: '101' }))).error).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      (
        await errorBody(
          service.create(PROPERTY, {
            personId: PERSON,
            since: '2026-05-01T00:00:00.000Z',
            until: '2026-01-01T00:00:00.000Z',
          }),
        )
      ).error,
    ).toBe('VALIDATION_ERROR');
  });

  it('404 si la propiedad o la persona no existen', async () => {
    const { client, service } = setup();
    client.property.findFirst.mockResolvedValue(null);
    expect((await errorBody(service.create(PROPERTY, { personId: PERSON }))).error).toBe('PROPERTY_NOT_FOUND');

    client.property.findFirst.mockResolvedValue({ id: PROPERTY });
    client.person.findFirst.mockResolvedValue(null);
    expect((await errorBody(service.create(PROPERTY, { personId: PERSON }))).error).toBe('PERSON_NOT_FOUND');
  });

  it('quita un titular de esa propiedad y 404 si no es de ella', async () => {
    const { client, service } = setup();
    client.propertyOwnership.findFirst.mockResolvedValueOnce({ id: 'o1' });

    await expect(service.remove(PROPERTY, 'o1')).resolves.toEqual({ deleted: true });

    client.propertyOwnership.findFirst.mockResolvedValueOnce(null);
    expect((await errorBody(service.remove(PROPERTY, 'o2'))).error).toBe('OWNERSHIP_NOT_FOUND');
  });
});
