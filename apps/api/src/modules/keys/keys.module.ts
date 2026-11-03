import { Module } from '@nestjs/common';
import { KeysController, PropertyKeysController } from './keys.controller';
import { KeysService } from './keys.service';

/** Llaves de las propiedades: juegos, quién las tiene y sus salidas (D14). */
@Module({
  controllers: [PropertyKeysController, KeysController],
  providers: [KeysService],
  exports: [KeysService],
})
export class KeysModule {}
