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
import { buildContractTemplateData, type ContractTemplateContext } from './contract-variable-builder';
import { rentAtDate } from '../liquidaciones/rent-at';
import {
  CreateContractTemplateSchema,
  UpdateContractTemplateSchema,
  ContractTemplateFilterSchema,
  GenerateDocumentSchema,
} from '@realfy/shared';
import {
  renderTemplatePlain,
  extractTemplateVariables,
  TemplateSyntaxError,
  TEMPLATE_LIST_NAMES,
} from '@realfy/shared';
import { DEFAULT_TEMPLATES } from './default-templates';
import { parseOrThrow } from '../../common/validation/zod';

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

/** Una plantilla mal formada es un error del pedido (400), con la línea y la columna donde falla. */
function templateSyntaxToHttp(err: unknown): never {
  if (err instanceof TemplateSyntaxError) {
    throw new BadRequestException({
      error: 'TEMPLATE_SYNTAX_ERROR',
      message: err.message,
      details: { code: err.code, line: err.line, column: err.column },
    });
  }
  throw err;
}

const TEMPLATE_OPTIONS = { lists: TEMPLATE_LIST_NAMES };

/** Revisa la sintaxis del cuerpo y devuelve las variables que usa. */
function checkedVariables(body: string): string[] {
  try {
    return extractTemplateVariables(body, TEMPLATE_OPTIONS);
  } catch (err) {
    return templateSyntaxToHttp(err);
  }
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
    const validated: any = parseOrThrow(CreateContractTemplateSchema, body, 'Invalid contract template data');

    const tenantId = this.tenantContext.getTenantId()!;

    // Rechaza una plantilla mal formada y, si no vienen, extrae las variables del cuerpo
    const detected = checkedVariables(validated.body);
    const variables = validated.variables.length > 0 ? validated.variables : detected;

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
    const filters: any = parseOrThrow(ContractTemplateFilterSchema, query, 'Invalid filter parameters');

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
    const validated: any = parseOrThrow(UpdateContractTemplateSchema, body, 'Invalid contract template update data');

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

    // Rechaza una plantilla mal formada y, si cambió el cuerpo sin variables, las vuelve a extraer
    if (validated.body) {
      const detected = checkedVariables(validated.body);
      if (!validated.variables) validated.variables = detected;
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

    const { variables } = await this.templateData(contract, tenant);
    return variables;
  }

  /**
   * Variables y listas de un contrato. Suma lo que el contrato no trae en sí:
   * cuentas de Rentas y de Aguas (servicios de la propiedad), canon inicial y
   * firma del período original.
   */
  private async templateData(contract: any, tenant: any, signingDate?: string) {
    const [services, period, termsVersions] = await Promise.all([
      this.prisma.client.service.findMany({
        where: { propertyId: contract.propertyId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { serviceType: true, accountNumber: true },
      }),
      this.prisma.client.contractPeriod.findFirst({
        where: { contractId: contract.id, seq: 1 },
        select: { initialRent: true, signedAt: true },
      }),
      this.prisma.client.contractTermsVersion.findMany({
        where: { contractId: contract.id },
        orderBy: { validFrom: 'asc' },
        select: { validFrom: true, rentOverride: true },
      }),
    ]);

    const context: ContractTemplateContext = {
      services,
      initialRent:
        period?.initialRent ??
        rentAtDate({
          contractRent: contract.rentAmount,
          adjustments: contract.adjustments ?? [],
          termsVersions,
          date: new Date(contract.startDate),
        }).amount,
      signedAt: period?.signedAt,
      signingDate,
    };
    return buildContractTemplateData(contract, tenant, context);
  }

  // ─── Generate Document ────────────────────────────────

  async generateDocument(contractId: string, body: unknown) {
    const validated: any = parseOrThrow(GenerateDocumentSchema, body, 'Invalid generate document request');

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
    const { variables, lists } = await this.templateData(contract, tenant, validated.signingDate);
    let resolvedText: string;
    try {
      resolvedText = renderTemplatePlain(template.body, variables, lists, TEMPLATE_OPTIONS);
    } catch (err) {
      return templateSyntaxToHttp(err);
    }

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
            variables: checkedVariables(tmpl.body),
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
