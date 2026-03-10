import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { QueryEngineService, getDateFilter } from '../query-engine.service';
import { Client } from '../../../database/models/client.model';
import { AlertRecord } from '../../../database/models/alert.model';
import { Meeting } from '../../../database/models/meeting.model';
import { ParsedQuery, QueryResult } from '../query-engine.dto';

// ---------------------------------------------------------------------------
// Mock model factory
// ---------------------------------------------------------------------------

const mockExec = jest.fn();
const mockLean = jest.fn(() => ({ exec: mockExec }));
const mockSort: jest.Mock = jest.fn(() => ({ limit: mockLimit, lean: mockLean, exec: mockExec }));
const mockLimit: jest.Mock = jest.fn(() => ({ lean: mockLean, sort: mockSort, exec: mockExec }));
const mockFind = jest.fn(() => ({ limit: mockLimit, sort: mockSort, lean: mockLean, exec: mockExec }));
const mockFindOne = jest.fn(() => ({ lean: mockLean }));
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn(() => ({ exec: mockExec }));

function makeMockModel() {
  return {
    find: mockFind,
    findOne: mockFindOne,
    countDocuments: mockCountDocuments,
    aggregate: mockAggregate,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('QueryEngineService', () => {
  let service: QueryEngineService;
  const RM_ID = 'rm-test-001';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryEngineService,
        { provide: getModelToken(Client.name), useValue: makeMockModel() },
        { provide: getModelToken(AlertRecord.name), useValue: makeMockModel() },
        { provide: getModelToken(Meeting.name), useValue: makeMockModel() },
      ],
    }).compile();

    service = module.get<QueryEngineService>(QueryEngineService);
  });

  // =========================================================================
  // parseQuery — intent & filter extraction
  // =========================================================================

  describe('parseQuery', () => {
    // -----------------------------------------------------------------------
    // COUNT
    // -----------------------------------------------------------------------

    it('parses "How many Diamond clients do I have?" → COUNT + tier=DIAMOND', () => {
      const result = service.parseQuery('How many Diamond clients do I have?', RM_ID);

      expect(result.intent).toBe('COUNT');
      expect(result.collection).toBe('clients');
      expect(result.aggregation).toBe('count');

      const tierFilter = result.filters.find((f) => f.field === 'tier');
      expect(tierFilter).toBeDefined();
      expect(tierFilter!.value).toBe('DIAMOND');
    });

    it('parses "How many clients do I have?" → COUNT with no tier filter', () => {
      const result = service.parseQuery('How many clients do I have?', RM_ID);

      expect(result.intent).toBe('COUNT');
      expect(result.collection).toBe('clients');
      expect(result.aggregation).toBe('count');

      const tierFilter = result.filters.find((f) => f.field === 'tier');
      expect(tierFilter).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // FILTER_LIST
    // -----------------------------------------------------------------------

    it('parses "Show my Platinum clients" → FILTER_LIST + tier=PLATINUM', () => {
      const result = service.parseQuery('Show my Platinum clients', RM_ID);

      expect(result.intent).toBe('FILTER_LIST');
      expect(result.collection).toBe('clients');

      const tierFilter = result.filters.find((f) => f.field === 'tier');
      expect(tierFilter).toBeDefined();
      expect(tierFilter!.value).toBe('PLATINUM');
      expect(result.limit).toBe(20);
    });

    it('parses "List Gold clients" → FILTER_LIST + tier=GOLD', () => {
      const result = service.parseQuery('List Gold clients', RM_ID);

      expect(result.intent).toBe('FILTER_LIST');
      const tierFilter = result.filters.find((f) => f.field === 'tier');
      expect(tierFilter!.value).toBe('GOLD');
    });

    // -----------------------------------------------------------------------
    // AGGREGATE_SUM
    // -----------------------------------------------------------------------

    it('parses "What is my total AUM?" → AGGREGATE_SUM + field=total_aum', () => {
      const result = service.parseQuery('What is my total AUM?', RM_ID);

      expect(result.intent).toBe('AGGREGATE_SUM');
      expect(result.aggregation).toBe('sum');
      expect(result.field).toBe('total_aum');
      expect(result.collection).toBe('clients');
    });

    it('parses "Total assets under management" → AGGREGATE_SUM + field=total_aum', () => {
      const result = service.parseQuery('Total assets under management', RM_ID);

      expect(result.intent).toBe('AGGREGATE_SUM');
      expect(result.field).toBe('total_aum');
    });

    it('parses "Revenue YTD?" → AGGREGATE_SUM + field=total_revenue_ytd', () => {
      const result = service.parseQuery('Revenue YTD?', RM_ID);

      expect(result.intent).toBe('AGGREGATE_SUM');
      expect(result.aggregation).toBe('sum');
      expect(result.field).toBe('total_revenue_ytd');
    });

    it('parses "Total revenue this year" → AGGREGATE_SUM + field=total_revenue_ytd', () => {
      const result = service.parseQuery('Total revenue this year', RM_ID);

      expect(result.intent).toBe('AGGREGATE_SUM');
      expect(result.field).toBe('total_revenue_ytd');
    });

    // -----------------------------------------------------------------------
    // ALERT_QUERY
    // -----------------------------------------------------------------------

    it('parses "Show pending alerts" → ALERT_QUERY + status=PENDING', () => {
      const result = service.parseQuery('Show pending alerts', RM_ID);

      expect(result.intent).toBe('ALERT_QUERY');
      expect(result.collection).toBe('alerts');

      const statusFilter = result.filters.find((f) => f.field === 'status');
      expect(statusFilter).toBeDefined();
      expect(statusFilter!.value).toBe('PENDING');
    });

    it('parses "New alerts" → ALERT_QUERY + status=NEW', () => {
      const result = service.parseQuery('New alerts', RM_ID);

      expect(result.intent).toBe('ALERT_QUERY');
      const statusFilter = result.filters.find((f) => f.field === 'status');
      expect(statusFilter!.value).toBe('NEW');
    });

    // -----------------------------------------------------------------------
    // TIME_FILTER
    // -----------------------------------------------------------------------

    it('parses "Meetings today" → TIME_FILTER + meetings collection', () => {
      const result = service.parseQuery('Meetings today', RM_ID);

      expect(result.intent).toBe('TIME_FILTER');
      expect(result.collection).toBe('meetings');

      const dateFilter = result.filters.find((f) => f.field === 'scheduled_date');
      expect(dateFilter).toBeDefined();
      expect(dateFilter!.operator).toBe('gte');
    });

    it('parses "Meeting this week" → TIME_FILTER with week date range', () => {
      const result = service.parseQuery('Meeting this week', RM_ID);

      expect(result.intent).toBe('TIME_FILTER');
      expect(result.collection).toBe('meetings');
    });

    // -----------------------------------------------------------------------
    // FIND_CLIENT
    // -----------------------------------------------------------------------

    it('parses "Tell me about Priya Sharma" → FIND_CLIENT with name regex', () => {
      const result = service.parseQuery('Tell me about Priya Sharma', RM_ID);

      expect(result.intent).toBe('FIND_CLIENT');
      expect(result.collection).toBe('clients');

      const nameFilter = result.filters.find((f) => f.field === 'client_name');
      expect(nameFilter).toBeDefined();
      expect(nameFilter!.operator).toBe('regex');
      expect(String(nameFilter!.value)).toContain('Priya Sharma');
      expect(result.limit).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Idle cash
    // -----------------------------------------------------------------------

    it('parses "Clients with idle cash" → FILTER_LIST + cash_pct filter', () => {
      const result = service.parseQuery('Clients with idle cash', RM_ID);

      expect(result.intent).toBe('FILTER_LIST');
      expect(result.collection).toBe('clients');

      const cashFilter = result.filters.find((f) => f.field === 'cash_pct');
      expect(cashFilter).toBeDefined();
      expect(cashFilter!.operator).toBe('gt');
      expect(cashFilter!.value).toBe(15);
    });

    // -----------------------------------------------------------------------
    // rm_id always present
    // -----------------------------------------------------------------------

    it('always includes rm_id filter in parsed query', () => {
      const queries = [
        'How many clients',
        'Show Diamond clients',
        'Total AUM',
        'Pending alerts',
        'Meetings today',
        'Tell me about Rajesh',
      ];

      for (const q of queries) {
        const result = service.parseQuery(q, RM_ID);
        const rmFilter = result.filters.find((f) => f.field === 'rm_id');
        expect(rmFilter).toBeDefined();
        expect(rmFilter!.value).toBe(RM_ID);
        expect(rmFilter!.operator).toBe('eq');
      }
    });

    // -----------------------------------------------------------------------
    // UNKNOWN
    // -----------------------------------------------------------------------

    it('returns UNKNOWN intent for unrecognized queries', () => {
      const result = service.parseQuery('xyzzy frobnicator quantum entanglement', RM_ID);

      expect(result.intent).toBe('UNKNOWN');
      expect(result.collection).toBe('clients');

      // Still scoped to rm_id
      const rmFilter = result.filters.find((f) => f.field === 'rm_id');
      expect(rmFilter).toBeDefined();
      expect(rmFilter!.value).toBe(RM_ID);
    });
  });

  // =========================================================================
  // getDateFilter helper
  // =========================================================================

  describe('getDateFilter', () => {
    it('returns today date range starting at midnight', () => {
      const range = getDateFilter('today');
      const today = new Date();

      expect(range.start.getDate()).toBe(today.getDate());
      expect(range.start.getHours()).toBe(0);
      expect(range.end.getHours()).toBe(23);
    });

    it('returns tomorrow date range', () => {
      const range = getDateFilter('tomorrow');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(range.start.getDate()).toBe(tomorrow.getDate());
    });

    it('returns this week Monday–Sunday range', () => {
      const range = getDateFilter('this week');

      // Start should be <= today, end should be >= today
      const now = new Date();
      expect(range.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(range.end.getTime()).toBeGreaterThanOrEqual(now.getTime());

      // Span should be ~7 days
      const spanDays =
        (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24);
      expect(spanDays).toBeGreaterThanOrEqual(6);
      expect(spanDays).toBeLessThan(8);
    });
  });

  // =========================================================================
  // executeQuery — behavior tests
  // =========================================================================

  describe('executeQuery', () => {
    // -----------------------------------------------------------------------
    // COUNT
    // -----------------------------------------------------------------------

    it('executes COUNT query and returns numeric data', async () => {
      mockCountDocuments.mockResolvedValueOnce(12);

      const parsed = service.parseQuery('How many Diamond clients do I have?', RM_ID);
      const result: QueryResult = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('COUNT');
      expect(result.count).toBe(12);
      expect(result.data).toEqual({ count: 12 });
      expect(result.formatted_answer).toContain('12');
      expect(result.formatted_answer).toContain('DIAMOND');
    });

    it('COUNT returns singular "client" when count is 1', async () => {
      mockCountDocuments.mockResolvedValueOnce(1);

      const parsed = service.parseQuery('How many Gold clients do I have?', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.formatted_answer).toContain('1 GOLD client.');
    });

    // -----------------------------------------------------------------------
    // AGGREGATE_SUM
    // -----------------------------------------------------------------------

    it('formats AUM in Indian notation — Crores', async () => {
      mockExec.mockResolvedValueOnce([{ total: 142_500_000 }]);

      const parsed = service.parseQuery('What is my total AUM?', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('AGGREGATE_SUM');
      expect(result.formatted_answer).toContain('₹');
      expect(result.formatted_answer).toContain('Cr');
      expect(result.formatted_answer).toMatch(/14\.[2-3] Cr/);
    });

    it('formats AUM in Indian notation — Lakhs', async () => {
      mockExec.mockResolvedValueOnce([{ total: 5_500_000 }]);

      const parsed = service.parseQuery('Total assets', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.formatted_answer).toContain('L');
      expect(result.formatted_answer).toContain('₹');
    });

    it('formats AUM zero gracefully', async () => {
      mockExec.mockResolvedValueOnce([]);

      const parsed = service.parseQuery('Total AUM', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.formatted_answer).toContain('₹');
    });

    // -----------------------------------------------------------------------
    // FILTER_LIST
    // -----------------------------------------------------------------------

    it('executes FILTER_LIST and returns table widget', async () => {
      const mockClients = [
        { client_id: 'c1', client_name: 'Alice', tier: 'PLATINUM', total_aum: 5_000_000 },
        { client_id: 'c2', client_name: 'Bob', tier: 'PLATINUM', total_aum: 3_000_000 },
      ];
      mockExec.mockResolvedValueOnce(mockClients);

      const parsed = service.parseQuery('Show my Platinum clients', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('FILTER_LIST');
      expect(result.widgets_hint).toBe('TABLE');
      expect(result.count).toBe(2);
      expect(result.formatted_answer).toContain('2 PLATINUM clients');
    });

    // -----------------------------------------------------------------------
    // FIND_CLIENT
    // -----------------------------------------------------------------------

    it('executes FIND_CLIENT and returns CLIENT_SUMMARY widget', async () => {
      const mockClient = {
        client_id: 'c99',
        client_name: 'Rajesh Mehta',
        tier: 'DIAMOND',
        total_aum: 82_000_000,
        last_interaction: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
      mockExec.mockResolvedValueOnce(mockClient);

      const parsed = service.parseQuery('Tell me about Rajesh Mehta', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('FIND_CLIENT');
      expect(result.widgets_hint).toBe('CLIENT_SUMMARY');
      expect(result.formatted_answer).toContain('Rajesh Mehta');
      expect(result.formatted_answer).toContain('DIAMOND');
      expect(result.formatted_answer).toContain('₹');
    });

    it('handles FIND_CLIENT with no result gracefully', async () => {
      mockExec.mockResolvedValueOnce(null);

      const parsed = service.parseQuery('Tell me about NonExistent Person XYZ', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('FIND_CLIENT');
      expect(result.data).toBeNull();
      expect(result.formatted_answer).toContain('No client found');
    });

    // -----------------------------------------------------------------------
    // ALERT_QUERY
    // -----------------------------------------------------------------------

    it('executes ALERT_QUERY and returns ALERT_CARD widget with severity breakdown', async () => {
      const mockAlerts = [
        { alert_id: 'a1', title: 'Alert 1', severity: 'HIGH', status: 'PENDING' },
        { alert_id: 'a2', title: 'Alert 2', severity: 'MEDIUM', status: 'PENDING' },
        { alert_id: 'a3', title: 'Alert 3', severity: 'MEDIUM', status: 'PENDING' },
      ];
      mockExec.mockResolvedValueOnce(mockAlerts);

      const parsed = service.parseQuery('Show pending alerts', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('ALERT_QUERY');
      expect(result.widgets_hint).toBe('ALERT_CARD');
      expect(result.count).toBe(3);
      expect(result.formatted_answer).toContain('3');
      expect(result.formatted_answer).toContain('pending');
      expect(result.formatted_answer).toContain('HIGH');
      expect(result.formatted_answer).toContain('MEDIUM');
    });

    // -----------------------------------------------------------------------
    // TIME_FILTER
    // -----------------------------------------------------------------------

    it('executes TIME_FILTER and returns MEETING_LIST widget', async () => {
      const mockMeetings = [
        { meeting_id: 'm1', client_name: 'Priya', scheduled_date: new Date(), agenda: 'Review' },
        { meeting_id: 'm2', client_name: 'Raj', scheduled_date: new Date(), agenda: 'Onboard' },
      ];
      mockExec.mockResolvedValueOnce(mockMeetings);

      const parsed = service.parseQuery('Meetings today', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('TIME_FILTER');
      expect(result.widgets_hint).toBe('MEETING_LIST');
      expect(result.count).toBe(2);
      expect(result.formatted_answer).toContain('today');
    });

    // -----------------------------------------------------------------------
    // UNKNOWN
    // -----------------------------------------------------------------------

    it('returns UNKNOWN response for unrecognized query', async () => {
      const parsed = service.parseQuery('quantum frobnicator entanglement', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.intent).toBe('UNKNOWN');
      expect(result.formatted_answer).toContain("not sure");
    });

    // -----------------------------------------------------------------------
    // widgets_hint mapping
    // -----------------------------------------------------------------------

    it('returns correct widgets_hint for COUNT intent', async () => {
      mockCountDocuments.mockResolvedValueOnce(5);

      const parsed = service.parseQuery('How many clients do I have?', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.widgets_hint).toBe('METRIC_CARD');
    });

    it('returns correct widgets_hint for AGGREGATE_SUM intent', async () => {
      mockExec.mockResolvedValueOnce([{ total: 1_000_000 }]);

      const parsed = service.parseQuery('Total AUM', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.widgets_hint).toBe('METRIC_CARD');
    });

    // -----------------------------------------------------------------------
    // formatted_answer human-readable string
    // -----------------------------------------------------------------------

    it('formats COUNT answer as human-readable sentence', async () => {
      mockCountDocuments.mockResolvedValueOnce(7);

      const parsed = service.parseQuery('How many Silver clients do I have?', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.formatted_answer).toMatch(/You have 7 SILVER clients\./);
    });

    it('formats AUM sum as human-readable Indian notation', async () => {
      mockExec.mockResolvedValueOnce([{ total: 750_000_000 }]);

      const parsed = service.parseQuery('What is total AUM?', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);

      expect(result.formatted_answer).toMatch(/Your total AUM is ₹75\.0 Cr\./);
    });
  });

  // =========================================================================
  // formatIndian — private method tested via public output
  // =========================================================================

  describe('formatIndian (via executeQuery output)', () => {
    it('formats values >= 10M as Cr', async () => {
      mockExec.mockResolvedValueOnce([{ total: 10_000_000 }]);
      const parsed = service.parseQuery('Total AUM', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);
      expect(result.formatted_answer).toContain('Cr');
    });

    it('formats values >= 100K and < 10M as L', async () => {
      mockExec.mockResolvedValueOnce([{ total: 500_000 }]);
      const parsed = service.parseQuery('Total AUM', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);
      expect(result.formatted_answer).toContain('L');
    });

    it('formats values >= 1K and < 100K as K', async () => {
      mockExec.mockResolvedValueOnce([{ total: 50_000 }]);
      const parsed = service.parseQuery('Total AUM', RM_ID);
      const result = await service.executeQuery(parsed, RM_ID);
      expect(result.formatted_answer).toContain('K');
    });
  });
});
