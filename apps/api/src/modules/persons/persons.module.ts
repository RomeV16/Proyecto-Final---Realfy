import { Module } from '@nestjs/common';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';
import { PersonBankAccountsService } from './person-bank-accounts.service';
import { PersonPowersService } from './person-powers.service';

@Module({
  controllers: [PersonsController],
  providers: [PersonsService, PersonBankAccountsService, PersonPowersService],
  exports: [PersonsService],
})
export class PersonsModule {}
