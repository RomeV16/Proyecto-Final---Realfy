import { Controller, Get, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_READ_ROLES } from '../../common/auth/role-groups';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(...BILLING_READ_ROLES)
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.paymentsService.list(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('debt')
  @Roles(...BILLING_READ_ROLES)
  debt() {
    return this.paymentsService.debtSummary();
  }
}
