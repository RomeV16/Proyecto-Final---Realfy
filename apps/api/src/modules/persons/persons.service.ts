import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MediaService } from '../../common/media/media.service';
import { S3Service } from '../../common/media/s3.service';
import {
  CreatePersonSchema,
  UpdatePersonSchema,
  PersonFilterSchema,
  AssignPersonRoleSchema,
} from '@realfy/shared';

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

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
    private readonly s3: S3Service,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = PersonFilterSchema.parse(query);
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

    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.fiscalCondition) where.fiscalCondition = filters.fiscalCondition;

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
    let validated: any;
    try {
      validated = CreatePersonSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid person data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    const person = await this.prisma.client.person.create({
      data: {
        ...validated,
        tenantId,
      },
      include: {
        roles: true,
        documents: true,
      },
    });

    this.logger.log(
      `Person created: personId=${person.id} name=${person.firstName} ${person.lastName} tenantId=${tenantId}`,
    );

    return person;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdatePersonSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid person data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.person.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    const updated = await this.prisma.client.person.update({
      where: { id },
      data: validated,
      include: {
        roles: true,
        documents: true,
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
    let validated: any;
    try {
      validated = AssignPersonRoleSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid role data',
          details: err.errors,
        });
      }
      throw err;
    }

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

    const assignment = await this.prisma.client.personRoleAssignment.create({
      data: {
        personId,
        role: validated.role,
        tenantId,
        propertyId: validated.propertyId ?? null,
        guarantorForPersonId: validated.guarantorForPersonId ?? null,
      },
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
}
