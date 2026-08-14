import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CommonEmailService } from '../../common/email/common-email.service';
import {
  CreateEmailTemplateSchema,
  UpdateEmailTemplateSchema,
  EmailTemplateFilterSchema,
  PreviewEmailTemplateSchema,
  SendEmailSchema,
  InteractionType,
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
    private readonly emailService: CommonEmailService,
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

  // ─── Send Email via Template ──────────────────────────

  async sendEmail(leadId: string, body: unknown) {
    let validated: any;
    try {
      validated = SendEmailSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid send email data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Check email service configuration
    if (!this.emailService.isConfigured()) {
      throw new BadRequestException({
        error: 'EMAIL_NOT_CONFIGURED',
        message: 'Email service is not configured. Set RESEND_API_KEY environment variable.',
      });
    }

    // Fetch template
    const template = await this.prisma.client.emailTemplate.findFirst({
      where: { id: validated.templateId },
    });

    if (!template) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Email template not found',
      });
    }

    // Fetch lead with full relations
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
      include: {
        person: true,
        pipeline: true,
        currentStage: true,
        property: true,
        assignedToUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    // Verify lead's person has an email
    if (!lead.person.email) {
      throw new BadRequestException({
        error: 'PERSON_NO_EMAIL',
        message: 'The lead\'s contact person has no email address',
      });
    }

    // Build variable map from lead data
    const variableMap: Record<string, string> = {};

    // Person fields
    if (lead.person.firstName) variableMap.nombre = lead.person.firstName;
    if (lead.person.lastName) variableMap.apellido = lead.person.lastName;
    if (lead.person.firstName && lead.person.lastName) {
      variableMap.nombreCompleto = `${lead.person.firstName} ${lead.person.lastName}`;
    }
    if (lead.person.email) variableMap.email = lead.person.email;
    if (lead.person.phone) variableMap.telefono = lead.person.phone;

    // Property fields
    if (lead.property) {
      variableMap.propiedad = lead.property.title || `${lead.property.street ?? ''} ${lead.property.number ?? ''}`.trim();
      if (lead.property.street && lead.property.number) {
        variableMap.direccion = `${lead.property.street} ${lead.property.number}`;
      }

      // Fetch property operation for precio
      const operation = await this.prisma.client.propertyOperation.findFirst({
        where: { propertyId: lead.property.id },
        orderBy: { createdAt: 'desc' },
      });
      if (operation?.price) {
        variableMap.precio = Number(operation.price).toLocaleString('es-AR', {
          minimumFractionDigits: 2,
        });
      }
    }

    // Pipeline/stage fields
    if (lead.pipeline) variableMap.pipeline = lead.pipeline.name;
    if (lead.currentStage) variableMap.etapa = lead.currentStage.name;

    // Agent fields
    if (lead.assignedToUser) {
      variableMap.agente = `${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName}`;
    }

    // Merge auto-resolved variables with user-provided overrides
    const mergedVariables = { ...variableMap, ...validated.variables };

    // Render template with merged variables (allow subject/body overrides)
    const finalSubject = validated.subject ?? template.subject;
    const finalBody = validated.body ?? template.body;
    const renderedSubject = renderTemplate(finalSubject, mergedVariables);
    const renderedBody = renderTemplate(finalBody, mergedVariables);

    const to = validated.to;
    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId() ?? null;

    // Send email via Resend
    const result = await this.emailService.sendEmail({
      to,
      subject: renderedSubject,
      html: renderedBody,
    });

    if (!result) {
      this.logger.error('Email send failed', {
        templateId: template.id,
        leadId,
        to,
        tenantId,
      });
      throw new BadRequestException({
        error: 'EMAIL_SEND_FAILED',
        message: 'Failed to send email. Please try again later.',
      });
    }

    // Auto-create Email interaction and update lastContactAt in a transaction
    const [interaction] = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.leadInteraction.create({
        data: {
          tenantId,
          leadId,
          type: InteractionType.Email,
          notes: `Email sent: "${renderedSubject}" to ${to} (template: ${template.name})`,
          contactedBy: userId,
          occurredAt: new Date(),
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastContactAt: new Date() },
      });

      return [created];
    });

    this.logger.log('Email sent and interaction logged', {
      templateId: template.id,
      leadId,
      to,
      interactionId: interaction.id,
      resendId: result.id,
      tenantId,
    });

    return {
      emailId: result.id,
      interaction,
      renderedSubject,
    };
  }
}
