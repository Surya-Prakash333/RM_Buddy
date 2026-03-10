import { Module } from '@nestjs/common';
import { RBACService } from './rbac.service';

/**
 * RBACModule exposes RBACService for import by other modules that need to
 * evaluate role-based access control (e.g., SsoModule, a future policy module).
 *
 * The service is stateless — it performs no I/O and needs no infrastructure
 * providers, so the module requires no imports.
 */
@Module({
  providers: [RBACService],
  exports: [RBACService],
})
export class RBACModule {}
