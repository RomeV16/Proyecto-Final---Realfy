import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantContextModule } from './common/tenant/tenant-context.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
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
    AuthModule,
    TenantsModule,
    UsersModule,
    AuditLogsModule,
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
