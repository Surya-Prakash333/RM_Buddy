import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),

  // TTL configurations (in seconds)
  sessionTtl: 86400,       // 24 hours
  dashboardTtl: 86400,     // 24 hours
  clientListTtl: 900,      // 15 minutes
  alertListTtl: 300,       // 5 minutes
  workingMemoryTtl: 1800,  // 30 minutes
}));
