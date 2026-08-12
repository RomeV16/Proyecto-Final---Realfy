import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantContextModule } from './common/tenant/tenant-context.module';
import { MediaModule } from './common/media/media.module';
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
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { ServicesModule } from './modules/services/services.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RbacGuard } from './common/auth/rbac.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TenantContextModule,
    PrismaModule,
    MediaModule,
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
    ServicesModule,
    PenaltiesModule,
  ],
  controllers: [HealthController],
  providers: [
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
