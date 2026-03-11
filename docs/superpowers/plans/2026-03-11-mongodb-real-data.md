# Replace Mock Data with Real MongoDB Queries — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CORS login error, replace all hardcoded/mock data in dashboard.service.ts with real MongoDB queries, so every RM sees their own data from the database — on dashboard and in chat.

**Architecture:** The core-api dashboard service currently has ~8 methods returning hardcoded data. Each will be converted to query the `RM_Buddy` MongoDB database (collections: clients, portfolios, meetings, leads, alerts, pipeline). The agent orchestrator's crm_tool.py already calls these core-api endpoints, so fixing the service layer automatically fixes chat responses.

**Tech Stack:** NestJS, Mongoose (raw `connection.db.collection()` for flexibility), MongoDB, Express gateway

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/gateway/.env.gateway` | Modify | Add port 5174 to CORS_ORIGINS |
| `apps/core-api/src/modules/dashboard/dashboard.service.ts` | Modify | Replace 8 mock methods with MongoDB queries |
| `apps/core-api/src/modules/dashboard/dashboard.controller.ts` | Modify | Make sync controller methods async |
| `deployment/mongo/seed-data.js` | Modify | Add pipeline collection seed data, enrich alert messages |

---

## Chunk 1: Fix CORS & Login

### Task 1: Fix CORS to allow frontend port 5174

**Files:**
- Modify: `apps/gateway/.env.gateway:7`

The frontend Vite dev server is running on port 5174 (shifted from 5173). The gateway CORS_ORIGINS only allows 5173. Browser blocks all cross-origin requests.

- [ ] **Step 1: Update CORS_ORIGINS**

In `apps/gateway/.env.gateway`, change line 7:
```
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

- [ ] **Step 2: Restart gateway**

```bash
cd apps/gateway && npm run build && pm2 restart rm-gateway
```

- [ ] **Step 3: Verify**

```bash
curl -s -o /dev/null -w "%{http_code}" -H "Origin: http://localhost:5174" http://localhost:3000/api/v1/rm/list
# Expected: 200
```

---

## Chunk 2: Enrich Seed Data

### Task 2: Add pipeline seed data & meaningful alert messages

**Files:**
- Modify: `deployment/mongo/seed-data.js`

The `pipeline` collection is empty (0 docs) and alert messages are all "Auto-generated alert for review." — need real messages for production.

- [ ] **Step 1: Add alert message generation**

Replace the alert seeding loop (around line 260) to generate meaningful messages per alert type, and add client_name from a lookup.

- [ ] **Step 2: Add pipeline seed data**

After the alerts section (~line 274), add a pipeline seeding block:
- 3-8 pipeline items per RM
- Fields: pipeline_id, rm_id, client_id, client_name, product, stage, amount, probability_pct, expected_close_date, created_at

- [ ] **Step 3: Re-run seed script**

```bash
mongosh RM_Buddy deployment/mongo/seed-data.js
```

- [ ] **Step 4: Verify counts**

```bash
mongosh --quiet --eval "var db=db.getSiblingDB('RM_Buddy'); print('pipeline:', db.pipeline.countDocuments()); print('alerts sample:', JSON.stringify(db.alerts.findOne({}, {message:1, client_name:1})))"
```

---

## Chunk 3: Replace Mock Data in Dashboard Service

### Task 3: Replace getSummary() with real MongoDB aggregation

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:455-470`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:63-66`

- [ ] **Step 1: Make getSummary async, query MongoDB**

Replace the hardcoded `getSummary(rmId)` method with:
- Count clients: `db.collection('clients').countDocuments({ rm_id: rmId })`
- Count pending alerts: `db.collection('alerts').countDocuments({ rm_id: rmId, status: 'pending' })`
- Count today's meetings: `db.collection('meetings').countDocuments({ rm_id: rmId, status: 'scheduled', scheduled_date: { $gte: todayStart, $lte: todayEnd } })`
- Sum AUM: `db.collection('portfolios').aggregate([{ $match: { rm_id: rmId } }, { $group: { _id: null, total: { $sum: '$summary.total_aum' } } }])`
- Count leads: `db.collection('leads').countDocuments({ rm_id: rmId, status: { $nin: ['converted', 'lost'] } })`
- Sum pipeline: `db.collection('pipeline').aggregate([{ $match: { rm_id: rmId } }, { $group: { _id: null, total: { $sum: '$amount' } } }])`

- [ ] **Step 2: Update controller to await getSummary**

Change `dashboard.controller.ts` line 65 from sync to async:
```typescript
async getSummary(@RMIdentity() identity: RmIdentityPayload): Promise<ApiResponse<Record<string, unknown>>> {
  return buildResponse(await this.dashboardService.getSummary(identity.rm_id));
}
```

### Task 4: Replace getPortfolio() with real MongoDB query

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:546-605`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:97-103`

- [ ] **Step 1: Make getPortfolio async, query portfolios collection**

Query: `db.collection('portfolios').findOne({ rm_id: rmId, client_id: clientId })`
Format holdings with human-readable values (₹ Cr/L format).
Return 404-like empty response if not found.

- [ ] **Step 2: Update controller to await getPortfolio**

### Task 5: Replace getMeetings() with real MongoDB query

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:726-756`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:158-161`

- [ ] **Step 1: Make getMeetings async, query meetings collection**

Query: `db.collection('meetings').find({ rm_id: rmId, status: 'scheduled' }).sort({ scheduled_date: 1 }).limit(10)`
Join with clients collection to get client_name.
Format time from scheduled_date.

- [ ] **Step 2: Update controller to await getMeetings**

### Task 6: Replace getLeads() with real MongoDB query

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:762-797`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:169-175`

- [ ] **Step 1: Make getLeads async, query leads collection**

Query: `db.collection('leads').find({ rm_id: rmId }).sort({ created_at: -1 }).limit(20)`
Map status to stage labels (new→COLD, contacted→WARM, interested→HOT, proposal_sent→HOT).
Format potential_aum to ₹ Cr/L.

- [ ] **Step 2: Update controller to await getLeads**

### Task 7: Replace getPipeline() with real MongoDB query

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:803-833`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:179-185`

- [ ] **Step 1: Make getPipeline async, query pipeline collection**

Query: `db.collection('pipeline').find({ rm_id: rmId }).sort({ expected_close_date: 1 })`
Format amount to ₹ Cr/L.

- [ ] **Step 2: Update controller to await getPipeline**

### Task 8: Replace getDailyActions() with dynamic generation from alerts

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:667-720`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:147-150`

- [ ] **Step 1: Make getDailyActions async, derive from pending alerts + client data**

Query pending alerts for RM, join with clients to get names.
Generate meaningful action text based on alert_type:
- `drawdown` → "Review portfolio drawdown for {client_name} — take protective action"
- `cash_surplus` → "Contact {client_name} — deploy idle cash into suitable instruments"
- `birthday` → "Wish {client_name} happy birthday and schedule a review call"
- `anniversary` → "Send anniversary wishes to {client_name} and explore new opportunities"
- `rebalance` → "Rebalance portfolio for {client_name} — allocation has drifted"

Priority: high=1, medium=2, low=3. Sort by priority ascending.

- [ ] **Step 2: Update controller to await getDailyActions**

### Task 9: Replace getBriefing() with real data composition

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:643-661`

- [ ] **Step 1: Make getBriefing async, compose from real queries**

Call the real (now async) methods:
- `getAlerts(rmId)` for alert summary
- `getMeetings(rmId)` for today's meetings
- `getDailyActions(rmId)` for prioritized actions
Remove references to MOCK_ALERTS constant.

### Task 10: Fix acknowledgeAlert() to update MongoDB

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:631-637`
- Modify: `apps/core-api/src/modules/dashboard/dashboard.controller.ts:120-128`

- [ ] **Step 1: Make acknowledgeAlert async, update MongoDB**

```typescript
async acknowledgeAlert(rmId: string, alertId: string) {
  await this.connection.db!.collection('alerts').updateOne(
    { alert_id: alertId, rm_id: rmId },
    { $set: { status: 'acknowledged', acknowledged_at: new Date() } },
  );
  return { alert_id: alertId, acknowledged: true, acknowledged_at: new Date().toISOString() };
}
```

- [ ] **Step 2: Update controller to await acknowledgeAlert**

### Task 11: Remove all mock data constants

**Files:**
- Modify: `apps/core-api/src/modules/dashboard/dashboard.service.ts:118-217`

- [ ] **Step 1: Delete MOCK_CLIENTS and MOCK_ALERTS arrays**

These are no longer referenced by any method.

---

## Chunk 4: Build, Deploy & Verify

### Task 12: Build and restart core-api

- [ ] **Step 1: Build**
```bash
cd apps/core-api && npm run build
```

- [ ] **Step 2: Restart**
```bash
pm2 restart rm-core-api
```

- [ ] **Step 3: Verify endpoints return real data**

```bash
# Summary should show real client count
curl -s -H 'X-RM-Identity: {"rm_id":"RM001"}' http://localhost:3001/api/v1/dashboard/summary | python3 -m json.tool

# Alerts should show only RM001's alerts
curl -s -H 'X-RM-Identity: {"rm_id":"RM001"}' http://localhost:3001/api/v1/alerts | python3 -m json.tool

# Meetings should show scheduled meetings for RM001
curl -s -H 'X-RM-Identity: {"rm_id":"RM001"}' http://localhost:3001/api/v1/meetings | python3 -m json.tool

# Leads should show RM001's leads
curl -s -H 'X-RM-Identity: {"rm_id":"RM001"}' http://localhost:3001/api/v1/leads | python3 -m json.tool

# Pipeline should show real items
curl -s -H 'X-RM-Identity: {"rm_id":"RM001"}' http://localhost:3001/api/v1/pipeline | python3 -m json.tool
```

- [ ] **Step 4: Test login flow in browser**

Open http://localhost:5174, select an RM, sign in. Dashboard should show real data specific to that RM.

- [ ] **Step 5: Test chat**

In the chat panel, ask "show me my clients" — should return real client data from MongoDB.
