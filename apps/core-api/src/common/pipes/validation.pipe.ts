import { ValidationPipe } from '@nestjs/common';

/**
 * Pre-configured ValidationPipe for the Core API.
 *
 * - whitelist: strips properties not present in the DTO class
 * - transform: auto-converts plain objects to DTO class instances
 * - forbidNonWhitelisted: false — silently strip extra props rather than throwing
 */
export const AppValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: false,
});
