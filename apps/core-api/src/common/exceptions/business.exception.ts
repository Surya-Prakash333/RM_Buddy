import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * BusinessException is a domain-level error that carries a machine-readable
 * error code, a human-readable message, and optional structured details.
 *
 * Usage:
 *   throw new BusinessException('CLIENT_NOT_FOUND', 'Client does not exist', HttpStatus.NOT_FOUND, { client_id });
 *
 * The exception filter will serialize this into the standard API error shape:
 *   { code, message, details, timestamp }
 */
export class BusinessException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, statusCode);
  }
}
