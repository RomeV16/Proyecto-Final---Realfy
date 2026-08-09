import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateEmailTemplateSchema,
  UpdateEmailTemplateSchema,
  EmailTemplateFilterSchema,
  PreviewEmailTemplateSchema,
} from '@realfy/shared';
import { renderTemplate, extractVariableNames } from '@realfy/shared';

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

/**
 * Checks if a Prisma error is a unique constraint violation (P2002).
 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as any).code === 'P2002'
  );
}

@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Create Template ──────────────────────────────────

  async create(body: unknown) {
    let validated: any;
    try {
      validated = CreateEmailTemplateSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid email template data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Auto-extract variables from subject + body if not provided
    const variables =
      validated.variables.length > 0
        ? validated.variables
        : [
            ...extractVariableNames(validated.subject),
            ...extractVariableNames(validated.body),
          ].filter((v, i, a) => a.indexOf(v) === i);

    try {
      const template = await this.prisma.client.emailTemplate.create({
        data: {
          tenantId,
          name: validated.name,
          subject: validated.subject,
          body: validated.body,
          variables,
          isActive: validated.isActive,
        },
      });

      this.logger.log('Email template created', {
        templateId: template.id,
        name: template.name,
        tenantId,
      });

      return template;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new BadRequestException({
          error: 'TEMPLATE_NAME_EXISTS',
          message: `A template named '${validated.name}' already exists`,
        });
      }
      throw err;
    }
  }

  // ─── List Templates ───────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = EmailTemplateFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid filter parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const where: any = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.emailTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.emailTemplate.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Find One Template ────────────────────────────────

  async findOne(id: string) {
    const template = await this.prisma.client.emailTemplate.findFirst({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Email template not found',
      });
    }

    return template;
  }

  // ─── Update Template ──────────────────────────────────

  async update(id: string, body: unknown) {
    let validated: any;
    try {
      validated = UpdateEmailTemplateSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid email template update data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Verify template exists
    const existing = await this.prisma.client.emailTemplate.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Email template not found',
      });
    }

    // Auto-update variables if subject or body changed and variables not explicitly provided
    if ((validated.subject || validated.body) && !validated.variables) {
      const subject = validated.subject ?? existing.subject;
      const body = validated.body ?? existing.body;
      validated.variables = [
        ...extractVariableNames(subject),
        ...extractVariableNames(body),
      ].filter((v, i, a) => a.indexOf(v) === i);
    }

    try {
      const template = await this.prisma.client.emailTemplate.update({
        where: { id },
        data: validated,
      });

      this.logger.log('Email template updated', {
        templateId: template.id,
        name: template.name,
        tenantId: template.tenantId,
        fieldsUpdated: Object.keys(validated),
      });

      return template;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new BadRequestException({
          error: 'TEMPLATE_NAME_EXISTS',
          message: `A template named '${validated.name}' already exists`,
        });
      }
      throw err;
    }
  }

  // ─── Delete Template ──────────────────────────────────

  async remove(id: string) {
    const existing = await this.prisma.client.emailTemplate.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Email template not found',
      });
    }

    await this.prisma.client.emailTemplate.delete({
      where: { id },
    });

    this.logger.log('Email template deleted', {
      templateId: existing.id,
      name: existing.name,
      tenantId: existing.tenantId,
    });

    return { deleted: true };
  }

  // ─── Preview Template ─────────────────────────────────

  async preview(id: string, body: unknown) {
    let validated: any;
    try {
      validated = PreviewEmailTemplateSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid preview data',
          details: err.errors,
        });
      }
      throw err;
    }

    const renderedSubject = renderTemplate(validated.subject, validated.variables);
    const renderedBody = renderTemplate(validated.body, validated.variables);

    return {
      subject: renderedSubject,
      body: renderedBody,
      variables: validated.variables,
    };
  }
}
