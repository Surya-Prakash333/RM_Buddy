// deployment/mongo/init-memory-indexes.js
// Run: mongosh "mongodb://m1b.dev.pr.com:27017/RM_Buddy" < deployment/mongo/init-memory-indexes.js

db = db.getSiblingDB("RM_Buddy");

// rm_facts — long-term memory facts
db.rm_facts.createIndex({ rm_id: 1, category: 1, active: 1 });
db.rm_facts.createIndex({ rm_id: 1, content: 1 }, { unique: true });

// conversation_summaries
db.conversation_summaries.createIndex({ rm_id: 1, created_at: -1 });

// agent_sessions — write-through session store
db.agent_sessions.createIndex({ session_id: 1 }, { unique: true });
db.agent_sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

print("Memory indexes created successfully.");
