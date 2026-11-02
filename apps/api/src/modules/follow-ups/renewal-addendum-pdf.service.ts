import { Injectable } from '@nestjs/common';
import {
  ContractPeriodKind,
  amountInWords,
  formatDateAR,
  formatMoneyAR,
  personName,
  propertyLabel,
} from '@realfy/shared';
import { PdfRendererService, pageFooter } from '../../common/pdf/pdf-renderer.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { badRequest, notFound } from '../cash/cash.errors';
import { getParties } from '../contracts/contract-parties';
import { getTermsAt } from '../contracts/contract-terms';

const ADJUSTMENT_LABEL: Record<string, string> = {
  IPC: 'el Índice de Precios al Consumidor (IPC)',
  ICL: 'el Índice para Contratos de Locación (ICL)',
  CCP: 'el índice CCP',
  UVA: 'la Unidad de Valor Adquisitivo (UVA)',
  FixedPercent: 'un porcentaje fijo',
  Custom: 'un porcentaje pactado',
  Escalonado: 'escalones pactados',
};

const PERIOD_LABEL: Record<string, string> = {
  Mensual: 'mensualmente',
  Bimestral: 'cada dos meses',
  Trimestral: 'trimestralmente',
  Cuatrimestral: 'cada cuatro meses',
  Semestral: 'semestralmente',
  Anual: 'anualmente',
};

const names = (rows: any[]): string => rows.map((r) => personName(r.person)).join(', ') || '—';

/**
 * Adenda corta de renovación: modelo sintético de una hoja que prorroga el
 * contrato por un período, fija el alquiler nuevo y la regla de ajuste, deja
 * constancia de los garantes y de los honorarios y ratifica el resto.
 */
@Injectable()
export class RenewalAddendumPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly renderer: PdfRendererService,
  ) {}

  async pdf(contractId: string, seq: number): Promise<{ buffer: Buffer; filename: string }> {
    const contract: any = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      include: {
        property: true,
        persons: { include: { person: true } },
        lessors: { include: { person: true } },
      },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const period: any = await this.prisma.client.contractPeriod.findFirst({ where: { contractId, seq } });
    if (!period) throw notFound('PERIOD_NOT_FOUND', 'Period not found');
    if (period.kind !== ContractPeriodKind.Renovacion) {
      throw badRequest('PERIOD_NOT_A_RENEWAL', 'Only a renewal period has an addendum');
    }

    const terms: any = await getTermsAt(this.prisma.client, contract, period.startDate);
    const tenant: any = await this.prisma.client.tenant.findFirst({ where: { id: this.tenantContext.getTenantId()! } });
    const guarantors: any[] = period.guarantorPersonIds.length
      ? await this.prisma.client.person.findMany({ where: { id: { in: period.guarantorPersonIds } } })
      : [];

    const rent = period.initialRent.toString();
    const lessors = names(contract.lessors);
    const tenants = names(getParties<any>(contract, 'Inquilino'));
    const rule = terms
      ? `${ADJUSTMENT_LABEL[terms.adjustmentType] ?? terms.adjustmentType}, ${PERIOD_LABEL[terms.adjustmentPeriod] ?? terms.adjustmentPeriod}`
      : null;

    const clause = (n: string, text: string) => ({ text: [{ text: `${n}. `, bold: true }, text], margin: [0, 0, 0, 8] });
    const buffer = await this.renderer.render({
      content: [
        { text: tenant?.name ?? 'Inmobiliaria', style: 'header', alignment: 'center' },
        tenant?.cuit ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center' } : { text: '' },
        { text: 'ADENDA DE RENOVACIÓN DE CONTRATO DE LOCACIÓN', style: 'title', alignment: 'center', margin: [0, 15, 0, 15] },
        {
          text: `Entre ${lessors}, en adelante LA PARTE LOCADORA, y ${tenants}, en adelante LA PARTE LOCATARIA, respecto del inmueble ${propertyLabel(contract.property) || '—'}, cuyo contrato original rige desde el ${formatDateAR(contract.startDate)}, se acuerda:`,
          margin: [0, 0, 0, 10],
        },
        clause('Primera', `Renovar la locación por el período del ${formatDateAR(period.startDate)} al ${formatDateAR(period.endDate)}.`),
        clause(
          'Segunda',
          `El alquiler mensual desde el ${formatDateAR(period.startDate)} es de ${contract.rentCurrency} ${formatMoneyAR(rent)} (${amountInWords(rent, contract.rentCurrency)}).`,
        ),
        ...(rule ? [clause('Tercera', `El alquiler se ajusta según ${rule}, conforme a las condiciones del contrato original.`)] : []),
        clause(
          'Cuarta',
          guarantors.length
            ? `Reafirman su garantía y se obligan solidariamente por el nuevo período: ${names(guarantors.map((person) => ({ person })))}.`
            : 'Las garantías del contrato original se mantienen vigentes durante el nuevo período.',
        ),
        ...(period.feeAmount
          ? [
              clause(
                'Quinta',
                `Los honorarios de renovación son de ${period.feeCurrency ?? contract.rentCurrency} ${formatMoneyAR(period.feeAmount.toString())} y se abonan a ${tenant?.name ?? 'la inmobiliaria'}.`,
              ),
            ]
          : []),
        clause('Final', 'El resto de las cláusulas del contrato original no modificadas por esta adenda permanece vigente.'),
        {
          columns: [
            { text: '\n\n______________________\nLa parte locadora', alignment: 'center' },
            { text: '\n\n______________________\nLa parte locataria', alignment: 'center' },
          ],
          margin: [0, 30, 0, 0],
        },
        ...(guarantors.length
          ? [
              {
                columns: guarantors.map((g) => ({
                  text: `\n\n______________________\n${personName(g)}\nGarante`,
                  alignment: 'center',
                })),
                margin: [0, 15, 0, 0],
              },
            ]
          : []),
        period.signedAt ? { text: `Firmada el ${formatDateAR(period.signedAt)}.`, margin: [0, 20, 0, 0] } : { text: '' },
      ],
      footer: pageFooter(tenant?.cuit ? `CUIT: ${tenant.cuit}` : null),
    });
    return { buffer, filename: `adenda-renovacion-${seq}.pdf` };
  }
}
