import { Controller, Get, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura)
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.paymentsService.list(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('debt')
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura)
  debt() {
    return this.paymentsService.debtSummary();
  }
}
