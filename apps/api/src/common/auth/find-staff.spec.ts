import { UserRole } from '@realfy/shared';
import { findStaff } from './find-staff';
import { MANAGEMENT_ROLES } from './role-groups';

describe('findStaff', () => {
  it('filtra por inmobiliaria, usuarios activos y los roles del grupo', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'u1' }]);
    const prisma = { baseClient: { user: { findMany } } };

    const res = await findStaff(prisma as never, 't1', MANAGEMENT_ROLES, { id: true });

    expect(res).toEqual([{ id: 'u1' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't1',
        isActive: true,
        role: { in: [UserRole.Admin, UserRole.Gerente] },
      },
      select: { id: true },
    });
  });
});
