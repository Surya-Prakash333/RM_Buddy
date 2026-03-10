/**
 * RM Buddy — MongoDB Seed Data Script
 *
 * Usage:
 *   mongosh rmbuddy seed-data.js
 *
 * Idempotent: clears target collections before inserting.
 * Data is scoped to the 'rmbuddy' database.
 */

db = db.getSiblingDB('rmbuddy');

var now = new Date();

function daysAgo(n) {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n) {
  return new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===========================================================================
// 1. RM PROFILES  (exactly 5 entries: 4 × RM\d{3} + 1 × BM\d{3})
// ===========================================================================
print('\n[rm_profiles] Seeding...');
db.rm_profiles.deleteMany({});

var rmProfiles = [
  {
    rm_id: 'RM001',
    rm_name: 'Rajesh Kumar',
    rm_email: 'rajesh.kumar@nuvama.com',
    rm_code: 'RK001',
    branch: 'Mumbai-BKC',
    region: 'West',
    role: 'RM',
    is_active: true,
    created_at: daysAgo(365),
  },
  {
    rm_id: 'RM002',
    rm_name: 'Sunita Malhotra',
    rm_email: 'sunita.malhotra@nuvama.com',
    rm_code: 'SM002',
    branch: 'Delhi-CP',
    region: 'North',
    role: 'RM',
    is_active: true,
    created_at: daysAgo(300),
  },
  {
    rm_id: 'RM003',
    rm_name: 'Amit Joshi',
    rm_email: 'amit.joshi@nuvama.com',
    rm_code: 'AJ003',
    branch: 'Bangalore-MG',
    region: 'South',
    role: 'RM',
    is_active: true,
    created_at: daysAgo(280),
  },
  {
    rm_id: 'RM004',
    rm_name: 'Ananya Iyer',
    rm_email: 'ananya.iyer@nuvama.com',
    rm_code: 'AI004',
    branch: 'Chennai-Anna',
    region: 'South',
    role: 'RM',
    is_active: true,
    created_at: daysAgo(200),
  },
  {
    rm_id: 'BM001',
    rm_name: 'Vikram Nair',
    rm_email: 'vikram.nair@nuvama.com',
    rm_code: 'VN001',
    branch: 'Mumbai-BKC',
    region: 'West',
    role: 'BM',
    is_active: true,
    created_at: daysAgo(400),
  },
];

db.rm_profiles.insertMany(rmProfiles);
print('[rm_profiles] Seeded ' + rmProfiles.length + ' profiles.');

// ===========================================================================
// 2. CLIENTS & PORTFOLIOS
// ===========================================================================
print('\n[clients] Clearing...');
db.clients.deleteMany({});
print('\n[portfolios] Clearing...');
db.portfolios.deleteMany({});

var tiers = ['DIAMOND', 'BLACK', 'PLATINUM', 'GOLD', 'SILVER'];
var assetClasses = ['EQ', 'FI', 'MP'];

var firstNames = [
  'Arjun', 'Priya', 'Rohit', 'Sneha', 'Vikram',
  'Kavya', 'Nikhil', 'Deepa', 'Rahul', 'Meera',
  'Aditya', 'Pooja', 'Siddharth', 'Nisha', 'Karan',
];
var lastNames = [
  'Sharma', 'Patel', 'Gupta', 'Singh', 'Mehta',
  'Verma', 'Agarwal', 'Jain', 'Kapoor', 'Reddy',
  'Nair', 'Pillai', 'Menon', 'Bose', 'Das',
];

var clientCounter = 0;

rmProfiles.forEach(function (rm) {
  var numClients = randomBetween(20, 50);

  for (var i = 0; i < numClients; i++) {
    clientCounter++;
    var clientId = 'CL' + String(clientCounter).padStart(5, '0');
    var firstName = pick(firstNames);
    var lastName = pick(lastNames);
    var clientName = firstName + ' ' + lastName;
    var tier = pick(tiers);
    var age = randomBetween(28, 75);
    var aum = randomBetween(500000, 50000000);

    db.clients.insertOne({
      client_id: clientId,
      rm_id: rm.rm_id,
      client_name: clientName,
      tier: tier,
      aum: aum,
      age: age,
      email: firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@email.com',
      phone: '9' + String(randomBetween(100000000, 999999999)),
      city: pick(['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Pune', 'Hyderabad']),
      last_interaction: daysAgo(randomBetween(1, 90)),
      created_at: daysAgo(randomBetween(90, 730)),
      is_active: true,
    });

    // Build holdings across asset classes
    var holdings = assetClasses.map(function (ac) {
      return {
        asset_class: ac,
        value: randomBetween(50000, aum / 2),
        weight_pct: randomBetween(5, 60),
      };
    });

    db.portfolios.insertOne({
      client_id: clientId,
      rm_id: rm.rm_id,
      holdings: holdings,
      summary: {
        total_aum: aum,
        cash_pct: randomBetween(2, 15),
        equity_pct: randomBetween(20, 60),
        debt_pct: randomBetween(20, 60),
        mf_pct: randomBetween(5, 30),
        xirr: randomBetween(8, 22) + Math.random(),
        as_of_date: now,
      },
      drawdown: {
        drawdown_pct: randomBetween(1, 20) + Math.random(),
        peak_aum: aum * (1 + randomBetween(5, 30) / 100),
        trough_aum: aum * (1 - randomBetween(5, 20) / 100),
      },
      updated_at: daysAgo(randomBetween(0, 7)),
    });
  }

  print('[clients+portfolios] RM ' + rm.rm_id + ': inserted ' + numClients + ' clients.');
});

// ===========================================================================
// 3. MEETINGS
// ===========================================================================
print('\n[meetings] Seeding...');
db.meetings.deleteMany({});

var meetingStatuses = ['scheduled', 'completed', 'cancelled'];
var meetingPurposes = ['Portfolio Review', 'Financial Planning', 'Product Pitch', 'KYC Update', 'Complaint Resolution'];
var meetingCounter = 0;

rmProfiles.forEach(function (rm) {
  for (var m = 0; m < randomBetween(5, 15); m++) {
    meetingCounter++;
    var meetingId = 'MT' + String(meetingCounter).padStart(5, '0');
    var status = pick(meetingStatuses);
    var scheduledDate = status === 'scheduled' ? daysFromNow(randomBetween(1, 30)) : daysAgo(randomBetween(1, 90));

    db.meetings.insertOne({
      meeting_id: meetingId,
      rm_id: rm.rm_id,
      client_id: 'CL' + String(randomBetween(1, clientCounter)).padStart(5, '0'),
      status: status,
      purpose: pick(meetingPurposes),
      scheduled_date: scheduledDate,
      duration_minutes: pick([30, 45, 60, 90]),
      notes: status === 'completed' ? 'Meeting completed. Follow-up actions noted.' : null,
      created_at: daysAgo(randomBetween(1, 120)),
    });
  }
});

print('[meetings] Seeded ' + meetingCounter + ' meetings.');

// ===========================================================================
// 4. LEADS
// ===========================================================================
print('\n[leads] Seeding...');
db.leads.deleteMany({});

var leadStatuses = ['new', 'contacted', 'interested', 'proposal_sent', 'converted', 'lost'];
var leadCounter = 0;

rmProfiles.forEach(function (rm) {
  for (var l = 0; l < randomBetween(3, 10); l++) {
    leadCounter++;
    var leadId = 'LD' + String(leadCounter).padStart(5, '0');

    db.leads.insertOne({
      lead_id: leadId,
      rm_id: rm.rm_id,
      lead_name: pick(firstNames) + ' ' + pick(lastNames),
      status: pick(leadStatuses),
      potential_aum: randomBetween(1000000, 20000000),
      source: pick(['referral', 'cold_call', 'event', 'digital', 'branch_walk_in']),
      expiry_date: daysFromNow(randomBetween(7, 60)),
      created_at: daysAgo(randomBetween(1, 180)),
    });
  }
});

print('[leads] Seeded ' + leadCounter + ' leads.');

// ===========================================================================
// 5. ALERTS
// ===========================================================================
print('\n[alerts] Seeding...');
db.alerts.deleteMany({});

var alertTypes = ['drawdown', 'cash_surplus', 'birthday', 'anniversary', 'rebalance'];
var alertCounter = 0;

rmProfiles.forEach(function (rm) {
  for (var a = 0; a < randomBetween(3, 8); a++) {
    alertCounter++;
    var alertId = 'AL' + String(alertCounter).padStart(5, '0');

    db.alerts.insertOne({
      alert_id: alertId,
      rm_id: rm.rm_id,
      alert_type: pick(alertTypes),
      client_id: 'CL' + String(randomBetween(1, clientCounter)).padStart(5, '0'),
      status: pick(['pending', 'acknowledged', 'dismissed']),
      priority: pick(['high', 'medium', 'low']),
      message: 'Auto-generated alert for review.',
      expires_at: daysFromNow(randomBetween(1, 14)),
      created_at: daysAgo(randomBetween(0, 30)),
    });
  }
});

print('[alerts] Seeded ' + alertCounter + ' alerts.');

// ===========================================================================
// Done
// ===========================================================================
print('\n========================================');
print('Seed data insertion complete.');
print('  rm_profiles : ' + db.rm_profiles.countDocuments() + ' docs');
print('  clients     : ' + db.clients.countDocuments() + ' docs');
print('  portfolios  : ' + db.portfolios.countDocuments() + ' docs');
print('  meetings    : ' + db.meetings.countDocuments() + ' docs');
print('  leads       : ' + db.leads.countDocuments() + ' docs');
print('  alerts      : ' + db.alerts.countDocuments() + ' docs');
print('========================================\n');
