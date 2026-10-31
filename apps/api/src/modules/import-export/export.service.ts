import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { buildCsv, buildXlsx, type TabularColumn } from '../../common/export/tabular';

const PROPERTY_COLUMNS: TabularColumn[] = [
  { header: 'Título', key: 'title', width: 30 },
  { header: 'Tipo', key: 'type', width: 15 },
  { header: 'Dirección', key: 'street', width: 25 },
  { header: 'Número', key: 'number', width: 10 },
  { header: 'Piso', key: 'floor', width: 8 },
  { header: 'Depto', key: 'apartment', width: 8 },
  { header: 'Ciudad', key: 'city', width: 20 },
  { header: 'Provincia', key: 'province', width: 20 },
  { header: 'CP', key: 'zipCode', width: 10 },
  { header: 'País', key: 'country', width: 15 },
  { header: 'Superficie (m²)', key: 'area', width: 15 },
  { header: 'Ambientes', key: 'rooms', width: 12 },
  { header: 'Dormitorios', key: 'bedrooms', width: 12 },
  { header: 'Baños', key: 'bathrooms', width: 10 },
  { header: 'Cocheras', key: 'garages', width: 10 },
  { header: 'Antigüedad', key: 'age', width: 12 },
  { header: 'Precio', key: 'price', width: 15 },
  { header: 'Moneda', key: 'currency', width: 10 },
];

const PERSON_COLUMNS: TabularColumn[] = [
  { header: 'Nombre', key: 'firstName', width: 20 },
  { header: 'Apellido', key: 'lastName', width: 20 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Teléfono', key: 'phone', width: 20 },
  { header: 'Teléfono 2', key: 'phone2', width: 20 },
  { header: 'CUIT/CUIL', key: 'cuit', width: 18 },
  { header: 'Condición Fiscal', key: 'fiscalCondition', width: 20 },
  { header: 'Banco', key: 'bankName', width: 20 },
  { header: 'CBU', key: 'cbu', width: 25 },
  { header: 'Alias Bancario', key: 'bankAlias', width: 20 },
  { header: 'Notas', key: 'notes', width: 30 },
];

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Properties Export ──────────────────────────────

  async exportPropertiesCsv(): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.fetchProperties();
    const csv = buildCsv(data, PROPERTY_COLUMNS);
    const fileName = `propiedades-${new Date().toISOString().slice(0, 10)}.csv`;

    this.logger.log(`Properties CSV export: ${data.length} rows`);

    return { buffer: Buffer.from(csv, 'utf-8'), fileName };
  }

  async exportPropertiesExcel(): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.fetchProperties();
    const buffer = await buildXlsx([{ name: 'Propiedades', columns: PROPERTY_COLUMNS, rows: data }]);
    const fileName = `propiedades-${new Date().toISOString().slice(0, 10)}.xlsx`;

    this.logger.log(`Properties Excel export: ${data.length} rows`);

    return { buffer, fileName };
  }

  // ─── Persons Export ─────────────────────────────────

  async exportPersonsCsv(): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.fetchPersons();
    const csv = buildCsv(data, PERSON_COLUMNS);
    const fileName = `personas-${new Date().toISOString().slice(0, 10)}.csv`;

    this.logger.log(`Persons CSV export: ${data.length} rows`);

    return { buffer: Buffer.from(csv, 'utf-8'), fileName };
  }

  async exportPersonsExcel(): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.fetchPersons();
    const buffer = await buildXlsx([{ name: 'Personas', columns: PERSON_COLUMNS, rows: data }]);
    const fileName = `personas-${new Date().toISOString().slice(0, 10)}.xlsx`;

    this.logger.log(`Persons Excel export: ${data.length} rows`);

    return { buffer, fileName };
  }

  // ─── Data Fetching ──────────────────────────────────

  private async fetchProperties(): Promise<Record<string, any>[]> {
    const properties = await this.prisma.client.property.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return properties.map((p: any) => ({
      title: p.title,
      type: p.type,
      street: p.street ?? '',
      number: p.number ?? '',
      floor: p.floor ?? '',
      apartment: p.apartment ?? '',
      city: p.city ?? '',
      province: p.province ?? '',
      zipCode: p.zipCode ?? '',
      country: p.country ?? '',
      area: p.area ? Number(p.area) : '',
      rooms: p.rooms ?? '',
      bedrooms: p.bedrooms ?? '',
      bathrooms: p.bathrooms ?? '',
      garages: p.garages ?? '',
      age: p.age ?? '',
      price: p.price ? Number(p.price) : '',
      currency: p.currency ?? '',
    }));
  }

  private async fetchPersons(): Promise<Record<string, any>[]> {
    const persons = await this.prisma.client.person.findMany({
      where: { isActive: true },
      include: { bankAccounts: { where: { isDefault: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return persons.map((p: any) => {
      // Cuenta predeterminada (en pesos si la tiene, si no la primera disponible).
      const account =
        p.bankAccounts?.find((a: any) => a.currency === 'ARS') ?? p.bankAccounts?.[0];
      return {
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email ?? '',
        phone: p.phone ?? '',
        phone2: p.phone2 ?? '',
        cuit: p.cuit ?? '',
        fiscalCondition: p.fiscalCondition ?? '',
        bankName: account?.bankName ?? '',
        cbu: account?.cbu ?? '',
        bankAlias: account?.alias ?? '',
        notes: p.notes ?? '',
      };
    });
  }
}
