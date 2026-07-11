import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ContractsService } from '../contracts/contracts.service';
import { ContractPdfService } from './contract-pdf.service';
import { ContractDocxService } from './contract-docx.service';
import { buildContractVariables } from './contract-variable-builder';
import {
  CreateContractTemplateSchema,
  UpdateContractTemplateSchema,
  ContractTemplateFilterSchema,
  GenerateDocumentSchema,
} from '@realfy/shared';
import { renderTemplatePlain, extractVariableNames } from '@realfy/shared';
import { DEFAULT_TEMPLATES } from './default-templates';

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
export class ContractTemplatesService {
  private readonly logger = new Logger(ContractTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly contractsService: ContractsService,
    private readonly pdfService: ContractPdfService,
    private readonly docxService: ContractDocxService,
  ) {}

  // ─── Create Template ──────────────────────────────────

  async create(body: unknown) {
    let validated: any;
    try {
      validated = CreateContractTemplateSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid contract template data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Auto-extract variables from body if not provided
    const variables =
      validated.variables.length > 0
        ? validated.variables
        : extractVariableNames(validated.body);

    try {
      const template = await this.prisma.client.contractTemplate.create({
        data: {
          tenantId,
          name: validated.name,
          contractType: validated.contractType,
          body: validated.body,
          variables,
          isDefault: validated.isDefault,
          isActive: validated.isActive,
        },
      });

      this.logger.log('Contract template created', {
        templateId: template.id,
        name: template.name,
        tenantId,
      });

      return template;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new BadRequestException({
          error: 'TEMPLATE_NAME_EXISTS',
          message: `A contract template named '${validated.name}' already exists`,
        });
      }
      throw err;
    }
  }

  // ─── List Templates ───────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = ContractTemplateFilterSchema.parse(query);
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

    const tenantId = this.tenantContext.getTenantId()!;
    const where: any = { tenantId };

    if (filters.contractType) {
      where.contractType = filters.contractType;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.contractTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.contractTemplate.count({ where }),
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
    const tenantId = this.tenantContext.getTenantId()!;
    const template = await this.prisma.client.contractTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!template) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Contract template not found',
      });
    }

    return template;
  }

  // ─── Update Template ──────────────────────────────────

  async update(id: string, body: unknown) {
    let validated: any;
    try {
      validated = UpdateContractTemplateSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid contract template update data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const existing = await this.prisma.client.contractTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Contract template not found',
      });
    }

    // Auto-update variables if body changed and variables not explicitly provided
    if (validated.body && !validated.variables) {
      validated.variables = extractVariableNames(validated.body);
    }

    try {
      const template = await this.prisma.client.contractTemplate.update({
        where: { id },
        data: validated,
      });

      this.logger.log('Contract template updated', {
        templateId: template.id,
        name: template.name,
        tenantId,
        fieldsUpdated: Object.keys(validated),
      });

      return template;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new BadRequestException({
          error: 'TEMPLATE_NAME_EXISTS',
          message: `A contract template named '${validated.name}' already exists`,
        });
      }
      throw err;
    }
  }

  // ─── Delete Template ──────────────────────────────────

  async remove(id: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    const existing = await this.prisma.client.contractTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Contract template not found',
      });
    }

    await this.prisma.client.contractTemplate.delete({
      where: { id },
    });

    this.logger.log('Contract template deleted', {
      templateId: existing.id,
      name: existing.name,
      tenantId,
    });

    return { deleted: true };
  }

  // ─── Available Templates for a Contract ───────────────

  async getAvailableTemplates(contractId: string) {
    const contract = await this.contractsService.findOne(contractId);
    const tenantId = this.tenantContext.getTenantId()!;

    const templates = await this.prisma.client.contractTemplate.findMany({
      where: {
        tenantId,
        contractType: contract.contractType,
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        contractType: true,
        isDefault: true,
        variables: true,
      },
    });

    return templates;
  }

  // ─── Template Variables for a Contract ────────────────

  async getTemplateVariables(contractId: string) {
    const contract = await this.contractsService.findOne(contractId);
    const tenantId = this.tenantContext.getTenantId()!;

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }

    const variables = buildContractVariables(contract as any, tenant);
    return variables;
  }

  // ─── Generate Document ────────────────────────────────

  async generateDocument(contractId: string, body: unknown) {
    let validated: any;
    try {
      validated = GenerateDocumentSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid generate document request',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Fetch template
    const template = await this.prisma.client.contractTemplate.findFirst({
      where: { id: validated.templateId, tenantId },
    });

    if (!template) {
      throw new NotFoundException({
        error: 'TEMPLATE_NOT_FOUND',
        message: 'Contract template not found',
      });
    }

    // Fetch contract with full relations
    const contract = await this.contractsService.findOne(contractId);

    // Fetch tenant
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }

    // Build variables and interpolate
    const variables = buildContractVariables(contract as any, tenant);
    const resolvedText = renderTemplatePlain(template.body, variables);

    const metadata = {
      title: template.name,
      contractType: template.contractType,
      tenantName: tenant.name,
    };

    // Generate document in requested format
    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    if (validated.format === 'pdf') {
      buffer = await this.pdfService.generatePdf(resolvedText, metadata);
      contentType = 'application/pdf';
      extension = 'pdf';
    } else {
      buffer = await this.docxService.generateDocx(resolvedText, metadata);
      contentType =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      extension = 'docx';
    }

    this.logger.log('Contract document generated', {
      contractId,
      templateId: template.id,
      format: validated.format,
      sizeBytes: buffer.length,
      tenantId,
    });

    return { buffer, contentType, extension, templateName: template.name };
  }

  // ─── Seed Default Templates ───────────────────────────

  /**
   * Creates default Argentine contract templates for the current tenant.
   * Idempotent: skips templates that already exist (by name + tenantId unique constraint).
   * Returns the list of created templates (empty array if all already exist).
   */
  async seedDefaults(): Promise<any[]> {
    const tenantId = this.tenantContext.getTenantId()!;

    // Check if defaults already exist for this tenant
    const existingDefaults = await this.prisma.client.contractTemplate.count({
      where: { tenantId, isDefault: true },
    });

    if (existingDefaults > 0) {
      this.logger.log('Default contract templates already exist', {
        tenantId,
        count: existingDefaults,
      });
      return [];
    }

    const created: any[] = [];

    for (const tmpl of DEFAULT_TEMPLATES) {
      try {
        const template = await this.prisma.client.contractTemplate.create({
          data: {
            tenantId,
            name: tmpl.name,
            contractType: tmpl.contractType as any,
            body: tmpl.body,
            variables: extractVariableNames(tmpl.body),
            isDefault: true,
            isActive: true,
          },
        });
        created.push(template);
      } catch (err) {
        // Skip if unique constraint violation (name already exists for tenant)
        if (isUniqueConstraintError(err)) {
          this.logger.warn('Default template already exists, skipping', {
            tenantId,
            name: tmpl.name,
          });
          continue;
        }
        throw err;
      }
    }

    this.logger.log('Default contract templates seeded', {
      tenantId,
      count: created.length,
    });

    return created;
  }
}
