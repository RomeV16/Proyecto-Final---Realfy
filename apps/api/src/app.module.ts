import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantContextModule } from './common/tenant/tenant-context.module';
import { MediaModule } from './common/media/media.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { PersonsModule } from './modules/persons/persons.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { IndexDataModule } from './modules/index-data/index-data.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ContractTemplatesModule } from './modules/contract-templates/contract-templates.module';
import { LiquidacionesModule } from './modules/liquidaciones/liquidaciones.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PortalAuthModule } from './modules/portal-auth/portal-auth.module';
import { PortalModule } from './modules/portal/portal.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EmailTemplatesModule } from './modules/email-templates/email-templates.module';
import { ServicesModule } from './modules/services/services.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { LeadsModule } from './modules/leads/leads.module';
import { InteractionsModule } from './modules/interactions/interactions.module';
import { PublicModule } from './modules/public/public.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { CommonEmailModule } from './common/email/common-email.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RbacGuard } from './common/auth/rbac.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    // El frontend proxea sus llamadas a la API, así que buena parte del tráfico
    // legítimo llega con la IP del proxy. El límite general es holgado a
    // propósito: corta avalanchas contra la API expuesta sin castigar a los
    // visitantes que entran por el frontend.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    TenantContextModule,
    PrismaModule,
    MediaModule,
    CryptoModule,
    CommonEmailModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    AuditLogsModule,
    PropertiesModule,
    PersonsModule,
    ContractsModule,
    IndexDataModule,
    PaymentsModule,
    DashboardModule,
    ContractTemplatesModule,
    LiquidacionesModule,
    InvoicesModule,
    ServicesModule,
    NotificationsModule,
    EmailTemplatesModule,
    PortalAuthModule,
    PortalModule,
    TicketsModule,
    ProvidersModule,
    PenaltiesModule,
    PipelinesModule,
    LeadsModule,
    InteractionsModule,
    PublicModule,
    ScoringModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard de límite de peticiones global — corre antes que el de auth para cortar
    // los picos sin sesión. El decorador @Throttle ajusta el límite por endpoint.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Guard JWT global — todos los endpoints requieren auth salvo los marcados con @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Guard RBAC global — restringe por rol con el decorador @Roles()
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    // Interceptor de auditoría global — registra todas las mutaciones
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
