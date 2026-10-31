import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MediaService } from '../../common/media/media.service';
import { S3Service } from '../../common/media/s3.service';
import {
  CreatePersonSchema,
  UpdatePersonSchema,
  PersonFilterSchema,
  AssignPersonRoleSchema,
  PersonRole,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';
import { rethrowExternalRefConflict } from '../../common/validation/external-ref';
import { splitBankShortcut, defaultAccountForCreate } from './person-bank-fields';
import { PersonBankAccountsService } from './person-bank-accounts.service';
import { ensureRole } from './person-roles.service';

const BANK_ACCOUNTS_INCLUDE: { orderBy: Prisma.PersonBankAccountOrderByWithRelationInput[] } = {
  orderBy: [{ currency: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
};

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
    private readonly s3: S3Service,
    private readonly bankAccounts: PersonBankAccountsService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(PersonFilterSchema, query, 'Invalid filter parameters');

    const where: any = {};

    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.fiscalCondition) where.fiscalCondition = filters.fiscalCondition;
    if (filters.personType) where.personType = filters.personType;
    if (filters.externalRef) where.externalRef = filters.externalRef;

    // Filter by role via nested roles junction
    if (filters.role) {
      where.roles = { some: { role: filters.role } };
    }

    // Search by firstName, lastName, or cuit
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { cuit: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.person.findMany({
        where,
        include: {
          roles: true,
          bankAccounts: BANK_ACCOUNTS_INCLUDE,
        },
        orderBy: { [filters.sortBy]: filters.sortOrder },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.person.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(id: string) {
    const person = await this.prisma.client.person.findFirst({
      where: { id },
      include: {
        roles: true,
        documents: { orderBy: { uploadedAt: 'desc' } },
        bankAccounts: BANK_ACCOUNTS_INCLUDE,
      },
    });

    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    return person;
  }

  // ─── Create ─────────────────────────────────────────

  async create(data: unknown) {
    const validated: any = parseOrThrow(CreatePersonSchema, data, 'Invalid person data');

    const tenantId = this.tenantContext.getTenantId()!;

    const { rest, bank } = splitBankShortcut(validated as Record<string, any>);

    let person;
    try {
      person = await this.prisma.client.person.create({
        data: {
          ...rest,
          tenantId,
          bankAccounts: defaultAccountForCreate(
            tenantId,
            bank,
            `${rest.firstName} ${rest.lastName}`.trim(),
          ),
        } as any,
        include: {
          roles: true,
          documents: true,
          bankAccounts: BANK_ACCOUNTS_INCLUDE,
        },
      });
    } catch (err) {
      rethrowExternalRefConflict(err, 'person');
    }

    this.logger.log(
      `Person created: personId=${person.id} name=${person.firstName} ${person.lastName} tenantId=${tenantId}`,
    );

    return person;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    const validated: any = parseOrThrow(UpdatePersonSchema, data, 'Invalid person data');

    const existing = await this.prisma.client.person.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    const { rest, bank } = splitBankShortcut(validated as Record<string, any>);

    let updated;
    try {
      updated = await this.prisma.client.person.update({
        where: { id },
        data: rest,
        include: {
          roles: true,
          documents: true,
        },
      });
    } catch (err) {
      rethrowExternalRefConflict(err, 'person');
    }

    if (bank) {
      await this.bankAccounts.applyShortcut(
        id,
        bank,
        `${updated.firstName} ${updated.lastName}`.trim(),
      );
    }
    updated = await this.prisma.client.person.findFirstOrThrow({
      where: { id },
      include: {
        roles: true,
        documents: true,
        bankAccounts: BANK_ACCOUNTS_INCLUDE,
      },
    });

    this.logger.log(`Person updated: personId=${id}`);

    return updated;
  }

  // ─── Soft Delete ────────────────────────────────────

  async softDelete(id: string) {
    const existing = await this.prisma.client.person.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    const deleted = await this.prisma.client.person.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Person soft-deleted: personId=${id}`);

    return deleted;
  }

  // ─── Role Management ───────────────────────────────

  async assignRole(personId: string, data: unknown) {
    const validated: any = parseOrThrow(AssignPersonRoleSchema, data, 'Invalid role data');

    // Check person exists
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId },
    });

    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    // Check if role already assigned (unique constraint would catch it, but give a better error)
    const existing = await this.prisma.client.personRoleAssignment.findFirst({
      where: { personId, role: validated.role },
    });

    if (existing) {
      throw new BadRequestException({
        error: 'ROLE_ALREADY_ASSIGNED',
        message: `Person already has the ${validated.role} role`,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // La asignación de rol es solo la etiqueta; la propiedad de un propietario
    // vive en PropertyOwnership y `propertyId` de la asignación ya no se escribe.
    const assignment = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await ensureRole(tx, personId, validated.role, {
        guarantorForPersonId: validated.guarantorForPersonId ?? null,
      });
      if (validated.role === PersonRole.Propietario && validated.propertyId) {
        const property = await tx.property.findFirst({ where: { id: validated.propertyId } });
        if (!property) {
          throw new BadRequestException({
            error: 'PROPERTY_NOT_FOUND',
            message: `Property ${validated.propertyId} not found`,
          });
        }
        await tx.propertyOwnership.create({
          data: { tenantId, propertyId: validated.propertyId, personId },
        });
      }
      return created;
    });

    this.logger.log(
      `Role assigned: personId=${personId} role=${validated.role}`,
    );

    return assignment;
  }

  async removeRole(personId: string, roleId: string) {
    const assignment = await this.prisma.client.personRoleAssignment.findFirst({
      where: { id: roleId, personId },
    });

    if (!assignment) {
      throw new NotFoundException({
        error: 'ROLE_ASSIGNMENT_NOT_FOUND',
        message: 'Role assignment not found',
      });
    }

    await this.prisma.client.personRoleAssignment.delete({
      where: { id: roleId },
    });

    this.logger.log(
      `Role removed: personId=${personId} roleId=${roleId} role=${assignment.role}`,
    );

    return { deleted: true };
  }

  // ─── Documents ──────────────────────────────────────

  async uploadDocument(
    personId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    // Check person exists
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId },
    });

    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const docId = crypto.randomUUID();
    const extension = file.originalname.split('.').pop() || 'bin';
    const key = `${tenantId}/persons/${personId}/${docId}.${extension}`;

    // For images, process through MediaService for resizing
    // For PDFs/other files, upload raw to S3
    if (file.mimetype.startsWith('image/')) {
      const keyPrefix = `${tenantId}/persons/${personId}/${docId}`;
      const processed = await this.media.processAndUpload(file, keyPrefix);

      const doc = await this.prisma.client.personDocument.create({
        data: {
          id: docId,
          personId,
          tenantId,
          fileName: file.originalname,
          url: processed.url,
          mimeType: file.mimetype,
          sizeBytes: processed.sizeBytes,
        },
      });

      this.logger.log(
        `Document uploaded (image): personId=${personId} docId=${docId} fileName=${file.originalname}`,
      );

      return doc;
    }

    // Non-image (PDF, etc.) — upload raw buffer to S3
    await this.s3.upload(key, file.buffer, file.mimetype);
    const url = this.s3.getObjectUrl(key);

    const doc = await this.prisma.client.personDocument.create({
      data: {
        id: docId,
        personId,
        tenantId,
        fileName: file.originalname,
        url,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
      },
    });

    this.logger.log(
      `Document uploaded (file): personId=${personId} docId=${docId} fileName=${file.originalname}`,
    );

    return doc;
  }

  async deleteDocument(personId: string, docId: string) {
    const doc = await this.prisma.client.personDocument.findFirst({
      where: { id: docId, personId },
    });

    if (!doc) {
      throw new NotFoundException({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Best-effort S3 cleanup — try both key patterns
    const docExtension = doc.fileName.split('.').pop() || 'bin';
    const rawKey = `${tenantId}/persons/${personId}/${docId}.${docExtension}`;
    const imagePrefix = `${tenantId}/persons/${personId}/${docId}`;

    if (doc.mimeType.startsWith('image/')) {
      await this.media.deleteMedia(imagePrefix);
    } else {
      await this.s3.delete(rawKey);
    }

    await this.prisma.client.personDocument.delete({
      where: { id: docId },
    });

    this.logger.log(
      `Document deleted: personId=${personId} docId=${docId}`,
    );

    return { deleted: true };
  }

  // ─── Invitaciones al portal ─────────────────────────

  /**
   * Crea una invitación al portal para un inquilino. Devuelve el token con el
   * que la persona define su contraseña; vence a los 7 días.
   */
  async createPortalInvitation(personId: string) {
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId },
    });

    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    if (!person.email) {
      throw new BadRequestException({
        error: 'PERSON_NO_EMAIL',
        message: 'Person must have an email address to receive a portal invitation',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId()!;
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.baseClient.portalInvitation.create({
      data: {
        personId,
        tenantId,
        invitedByUserId: userId,
        token,
        expiresAt,
      },
    });

    this.logger.log(
      `Portal invitation created: personId=${personId} invitationId=${invitation.id} invitedBy=${userId}`,
    );

    return {
      id: invitation.id,
      personId,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    };
  }
}
