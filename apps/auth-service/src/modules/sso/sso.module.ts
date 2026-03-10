import { Module } from '@nestjs/common';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SessionModule } from '../session/session.module';

/**
 * SsoModule owns the SSO token validation flow and exposes the auth HTTP
 * endpoints.
 *
 * It imports SessionModule so that SsoService can delegate session creation
 * to SessionService without having direct infrastructure dependencies.
 */
@Module({
  imports: [SessionModule],
  controllers: [SsoController],
  providers: [SsoService],
  exports: [SsoService],
})
export class SsoModule {}
