import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalJwtStrategy } from '../../common/auth/portal-jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'portal-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'dev-jwt-secret-change-me'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRY', '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PortalAuthController],
  providers: [PortalAuthService, PortalJwtStrategy],
  exports: [PortalAuthService, JwtModule],
})
export class PortalAuthModule {}
