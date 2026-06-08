import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /audit-logs — List audit entries for the current tenant.
   * Supports filtering by entity, date range, and pagination.
   * Auto-filtered by tenant_id via Prisma Extension.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get()
  async findAll(
    @Query('entity') entity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, any> = {};

    if (entity) {
      where.entity = entity;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) {
        where.createdAt.gte = new Date(from);
      }
      if (to) {
        where.createdAt.lte = new Date(to);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }
}
