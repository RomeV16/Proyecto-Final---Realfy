import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreatePersonBankAccountSchema,
  UpdatePersonBankAccountSchema,
  Currency,
  personName,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';
import { hasBankData } from './person-bank-fields';

/**
 * Cuentas bancarias de una persona, una o más por moneda. Regla: por cada
 * moneda con cuentas hay exactamente una predeterminada; el servicio la
 * mantiene al crear, editar y borrar.
 */
@Injectable()
export class PersonBankAccountsService {
  private readonly logger = new Logger(PersonBankAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async assertPerson(personId: string) {
    const person = await this.prisma.client.person.findFirst({ where: { id: personId } });
    if (!person) {
      throw new NotFoundException({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
    }
    return person;
  }

  private async findAccount(personId: string, accountId: string) {
    const account = await this.prisma.client.personBankAccount.findFirst({
      where: { id: accountId, personId },
    });
    if (!account) {
      throw new NotFoundException({
        error: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }
    return account;
  }

  async list(personId: string) {
    await this.assertPerson(personId);
    return this.prisma.client.personBankAccount.findMany({
      where: { personId },
      orderBy: [{ currency: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(personId: string, data: unknown) {
    const validated = parseOrThrow(CreatePersonBankAccountSchema, data, 'Invalid bank account data');
    const person = await this.assertPerson(personId);
    const tenantId = this.tenantContext.getTenantId()!;

    const sameCurrency = await this.prisma.client.personBankAccount.count({
      where: { personId, currency: validated.currency },
    });
    // La primera cuenta de una moneda es la predeterminada; si no, solo si se pide.
    const isDefault = sameCurrency === 0 ? true : validated.isDefault === true;

    const create = this.prisma.client.personBankAccount.create({
      data: {
        tenantId,
        personId,
        currency: validated.currency,
        bankName: validated.bankName ?? null,
        cbu: validated.cbu ?? null,
        alias: validated.alias ?? null,
        holder: validated.holder ?? personName(person),
        isDefault,
      },
    });

    if (isDefault && sameCurrency > 0) {
      const demote = this.prisma.client.personBankAccount.updateMany({
        where: { personId, currency: validated.currency, isDefault: true },
        data: { isDefault: false },
      });
      const [, created] = await this.prisma.client.$transaction([demote, create]);
      this.logger.log(`Bank account created (default swapped): personId=${personId}`);
      return created;
    }

    const created = await create;
    this.logger.log(`Bank account created: personId=${personId} accountId=${created.id}`);
    return created;
  }

  async update(personId: string, accountId: string, data: unknown) {
    const validated = parseOrThrow(UpdatePersonBankAccountSchema, data, 'Invalid bank account data');
    await this.assertPerson(personId);
    const account = await this.findAccount(personId, accountId);

    if (validated.isDefault === false && account.isDefault) {
      throw this.defaultRequired(account.currency);
    }

    const { isDefault, ...fields } = validated;
    const update = this.prisma.client.personBankAccount.update({
      where: { id: accountId },
      data: { ...fields, ...(isDefault === true ? { isDefault: true } : {}) },
    });

    if (isDefault === true && !account.isDefault) {
      const demote = this.prisma.client.personBankAccount.updateMany({
        where: { personId, currency: account.currency, isDefault: true },
        data: { isDefault: false },
      });
      const [, updated] = await this.prisma.client.$transaction([demote, update]);
      return updated;
    }
    return update;
  }

  async remove(personId: string, accountId: string) {
    await this.assertPerson(personId);
    const account = await this.findAccount(personId, accountId);

    if (account.isDefault) {
      const others = await this.prisma.client.personBankAccount.count({
        where: { personId, currency: account.currency, id: { not: accountId } },
      });
      if (others > 0) throw this.defaultRequired(account.currency);
    }

    await this.prisma.client.personBankAccount.delete({ where: { id: accountId } });
    this.logger.log(`Bank account deleted: personId=${personId} accountId=${accountId}`);
    return { deleted: true };
  }

  /**
   * Atajo de compatibilidad (bankName/cbu/bankAlias en el PATCH de la persona):
   * actualiza la cuenta predeterminada en pesos, o la crea si todavía no existe.
   */
  async applyShortcut(
    personId: string,
    bank: { bankName?: string | null; cbu?: string | null; bankAlias?: string | null },
    holder: string,
  ) {
    const tenantId = this.tenantContext.getTenantId()!;
    const current = await this.prisma.client.personBankAccount.findFirst({
      where: { personId, currency: Currency.ARS, isDefault: true },
    });
    const fields = {
      ...(bank.bankName !== undefined ? { bankName: bank.bankName } : {}),
      ...(bank.cbu !== undefined ? { cbu: bank.cbu } : {}),
      ...(bank.bankAlias !== undefined ? { alias: bank.bankAlias } : {}),
    };
    if (current) {
      await this.prisma.client.personBankAccount.update({ where: { id: current.id }, data: fields });
    } else if (hasBankData(bank)) {
      const hasArs = await this.prisma.client.personBankAccount.count({
        where: { personId, currency: Currency.ARS },
      });
      await this.prisma.client.personBankAccount.create({
        data: { tenantId, personId, currency: Currency.ARS, holder, isDefault: hasArs === 0, ...fields },
      });
    }
  }

  private defaultRequired(currency: string) {
    return new ConflictException({
      error: 'BANK_ACCOUNT_DEFAULT_REQUIRED',
      message: `Mark another ${currency} account as default first`,
    });
  }
}
