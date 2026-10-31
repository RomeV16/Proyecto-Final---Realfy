import { PersonRole } from '@realfy/shared';
import { ensureRole } from './person-roles.service';

function createClient(person: { tenantId: string } | null = { tenantId: 'tenant-1' }) {
  return {
    person: { findFirst: jest.fn().mockResolvedValue(person) },
    personRoleAssignment: { upsert: jest.fn().mockResolvedValue({ id: 'r1' }) },
  };
}

describe('ensureRole', () => {
  it('crea el rol con la inmobiliaria de la persona y no toca uno existente', async () => {
    const client = createClient();

    await ensureRole(client, 'p1', PersonRole.Apoderado);

    expect(client.person.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { tenantId: true },
    });
    expect(client.personRoleAssignment.upsert).toHaveBeenCalledWith({
      where: { personId_role: { personId: 'p1', role: 'Apoderado' } },
      create: {
        personId: 'p1',
        role: 'Apoderado',
        tenantId: 'tenant-1',
        guarantorForPersonId: null,
      },
      update: {},
    });
  });

  it('guarda a quién garantiza cuando es garante', async () => {
    const client = createClient();

    await ensureRole(client, 'p1', PersonRole.Garante, { guarantorForPersonId: 'p9' });

    expect(client.personRoleAssignment.upsert.mock.calls[0][0].create.guarantorForPersonId).toBe('p9');
  });

  it('falla si la persona no existe', async () => {
    const client = createClient(null);

    await expect(ensureRole(client, 'nope', PersonRole.Lead)).rejects.toThrow('not found');
    expect(client.personRoleAssignment.upsert).not.toHaveBeenCalled();
  });
});
