import { Module } from '@nestjs/common';
import { RmController } from './rm.controller';

@Module({
  controllers: [RmController],
})
export class RmModule {}
