import { Module } from '@nestjs/common';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';
import { PersonBankAccountsService } from './person-bank-accounts.service';

@Module({
  controllers: [PersonsController],
  providers: [PersonsService, PersonBankAccountsService],
  exports: [PersonsService],
})
export class PersonsModule {}
