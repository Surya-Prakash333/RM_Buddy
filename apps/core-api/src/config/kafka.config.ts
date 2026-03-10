import { registerAs } from '@nestjs/config';

/**
 * Kafka configuration for RM Buddy Core API.
 *
 * All settings are read from environment variables with safe defaults for
 * local development. In production, set KAFKA_BROKERS as a comma-separated
 * list of broker addresses (e.g. "broker1:9092,broker2:9092").
 *
 * Topics are declared here as constants so every service in this app
 * references the same string — never hardcode topic names elsewhere.
 */
export default registerAs('kafka', () => ({
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  clientId: process.env.KAFKA_CLIENT_ID || 'rm-buddy-core-api',
  groupId: process.env.KAFKA_GROUP_ID || 'core-api-group',
  connectionTimeout: 10_000,
  requestTimeout: 30_000,
  topics: {
    ALERTS_GENERATED: 'alerts.generated',
    ALERTS_DELIVERED: 'alerts.delivered',
    ALERTS_ACKNOWLEDGED: 'alerts.acknowledged',
    CRM_SYNC_COMPLETED: 'crm.sync.completed',
    AGENT_REQUEST: 'agent.request',
    AGENT_RESPONSE: 'agent.response',
    AUDIT_TRAIL: 'audit.trail',
  },
}));
