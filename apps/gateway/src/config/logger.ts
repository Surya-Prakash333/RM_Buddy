import { createLogger, format, transports } from 'winston';
import { config } from './env';

/**
 * Shared Winston logger instance.
 *
 * All output is structured JSON so log aggregators (ELK, CloudWatch) can parse
 * fields without regex. The timestamp is always ISO 8601.
 */
export const logger = createLogger({
  level: config.logLevel,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: true }),
    format.json(),
  ),
  transports: [
    new transports.Console({
      silent: process.env.NODE_ENV === 'test',
    }),
  ],
});
