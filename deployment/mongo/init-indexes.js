/**
 * RM Buddy — MongoDB Index Initialization Script
 *
 * Usage:
 *   mongosh rmbuddy init-indexes.js
 *
 * This script is idempotent. Re-running it will skip indexes that already exist
 * and create any that are missing.
 */

db = db.getSiblingDB('RM_Buddy');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function safeCreateIndex(col, keySpec, options) {
  try {
    db[col].createIndex(keySpec, options || {});
  } catch (e) {
    // Code 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict
    // Both mean the index already exists — safe to skip.
    if (e.code !== 85 && e.code !== 86) {
      throw e;
    }
    print('  [skip] index already exists: ' + JSON.stringify(keySpec));
  }
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------
print('\n[clients] Creating indexes...');

db.clients.createIndex({ rm_id: 1 });
db.clients.createIndex({ client_id: 1 }, { unique: true });
db.clients.createIndex({ rm_id: 1, tier: 1 });
db.clients.createIndex({ rm_id: 1, last_interaction: 1 });
db.clients.createIndex({ dob: 1 });
db.clients.createIndex({ client_name: 'text' });

print('[clients] Done. (' + db.clients.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// portfolios
// ---------------------------------------------------------------------------
print('\n[portfolios] Creating indexes...');

db.portfolios.createIndex({ client_id: 1 }, { unique: true });
db.portfolios.createIndex({ rm_id: 1 });
db.portfolios.createIndex({ 'summary.cash_pct': 1 });
db.portfolios.createIndex({ 'drawdown.drawdown_pct': 1 });

print('[portfolios] Done. (' + db.portfolios.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------
print('\n[transactions] Creating indexes...');

db.transactions.createIndex({ txn_id: 1 }, { unique: true });
db.transactions.createIndex({ rm_id: 1, txn_date: -1 });
db.transactions.createIndex({ client_id: 1, txn_date: -1 });

print('[transactions] Done. (' + db.transactions.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// meetings
// ---------------------------------------------------------------------------
print('\n[meetings] Creating indexes...');

db.meetings.createIndex({ meeting_id: 1 }, { unique: true });
db.meetings.createIndex({ rm_id: 1, scheduled_date: 1 });
db.meetings.createIndex({ rm_id: 1, status: 1 });

print('[meetings] Done. (' + db.meetings.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// leads
// ---------------------------------------------------------------------------
print('\n[leads] Creating indexes...');

db.leads.createIndex({ lead_id: 1 }, { unique: true });
db.leads.createIndex({ rm_id: 1, status: 1 });
db.leads.createIndex({ rm_id: 1, expiry_date: 1 });

print('[leads] Done. (' + db.leads.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------
print('\n[pipeline] Creating indexes...');

db.pipeline.createIndex({ pipeline_id: 1 }, { unique: true });
db.pipeline.createIndex({ rm_id: 1, status: 1 });
db.pipeline.createIndex({ rm_id: 1, expected_close_date: 1 });

print('[pipeline] Done. (' + db.pipeline.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// alerts
// ---------------------------------------------------------------------------
print('\n[alerts] Creating indexes...');

db.alerts.createIndex({ alert_id: 1 }, { unique: true });
db.alerts.createIndex({ rm_id: 1, status: 1, created_at: -1 });
db.alerts.createIndex({ rm_id: 1, alert_type: 1, client_id: 1 });
// TTL: MongoDB auto-expires documents when expires_at is reached (value is the expiry timestamp)
db.alerts.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

print('[alerts] Done. (' + db.alerts.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// alert_rules
// ---------------------------------------------------------------------------
print('\n[alert_rules] Creating indexes...');

db.alert_rules.createIndex({ rule_id: 1 }, { unique: true });
db.alert_rules.createIndex({ alert_type: 1, enabled: 1 });

print('[alert_rules] Done. (' + db.alert_rules.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// chat_history
// ---------------------------------------------------------------------------
print('\n[chat_history] Creating indexes...');

db.chat_history.createIndex({ session_id: 1 }, { unique: true });
db.chat_history.createIndex({ rm_id: 1, last_message_at: -1 });
// TTL: auto-expire sessions older than 7 days
db.chat_history.createIndex({ last_message_at: 1 }, { expireAfterSeconds: 604800 });

print('[chat_history] Done. (' + db.chat_history.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// rm_sessions
// ---------------------------------------------------------------------------
print('\n[rm_sessions] Creating indexes...');

db.rm_sessions.createIndex({ session_id: 1 }, { unique: true });
db.rm_sessions.createIndex({ rm_id: 1 });
// TTL: auto-expire sessions after 24 hours
db.rm_sessions.createIndex({ created_at: 1 }, { expireAfterSeconds: 86400 });

print('[rm_sessions] Done. (' + db.rm_sessions.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// audit_trail  (collection name from audit.model.ts: collection: 'audit_trail')
// ---------------------------------------------------------------------------
print('\n[audit_trail] Creating indexes...');

db.audit_trail.createIndex({ rm_id: 1, created_at: -1 });
db.audit_trail.createIndex({ entity_id: 1, entity_type: 1 });
db.audit_trail.createIndex({ action: 1, created_at: -1 });

print('[audit_trail] Done. (' + db.audit_trail.getIndexes().length + ' total indexes)');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
print('\n========================================');
print('Index initialization complete.');
print('Collections indexed:');
var collections = [
  'clients', 'portfolios', 'transactions', 'meetings',
  'leads', 'pipeline', 'alerts', 'alert_rules',
  'chat_history', 'rm_sessions', 'audit_trail',
];
collections.forEach(function (c) {
  print('  ' + c + ': ' + db[c].getIndexes().length + ' indexes');
});
print('========================================\n');
