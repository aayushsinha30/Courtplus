import { describe, expect, it } from 'vitest';
import type { CaseRecord, CourtEvent } from '@courtplus/contracts';
import { analyzeAdjournments, extractAdjournmentEvents, recommendNextHearing } from '../src/adjournments.js';

describe('Adjournment Analyzer engine', () => {
  const baseCase: CaseRecord = {
    id: 'case-test-1',
    personId: 'person-test-1',
    caseNo: 'CRA/102/2026',
    court: 'Court of Sessions, Raipur',
    judgeName: 'Hon. Justice R. Sharma',
    charges: [{ act: 'BNS', section: '115', stage: 'FRAMED', verified: true }],
    custody: [{ kind: 'judicial', start: '2026-01-01', ongoing: true }],
    events: [],
    pendingStatus: 'trial',
  };

  it('detects no adjournments for an on-schedule case', () => {
    const record: CaseRecord = {
      ...baseCase,
      events: [
        { on: '2026-01-10', kind: 'remand', note: 'First remand order' },
        { on: '2026-01-24', kind: 'chargesheet', note: 'Chargesheet filed' },
      ],
    };

    const analysis = analyzeAdjournments(record, '2026-02-01');
    expect(analysis.totalAdjournments).toBe(0);
    expect(analysis.totalDelayDays).toBe(0);
    expect(analysis.order17Rule1Exceeded).toBe(false);
    expect(analysis.bnss346DayToDayViolation).toBe(false);
    expect(analysis.riskLevel).toBe('LOW');
  });

  it('detects and classifies explicit and note-based adjournments', () => {
    const events: CourtEvent[] = [
      {
        on: '2026-01-15',
        kind: 'adjournment',
        adjournment: {
          requestedBy: 'petitioner',
          reason: 'counsel_absent',
          daysGranted: 14,
          recordedJustification: 'Counsel engaged in High Court',
        },
      },
      {
        on: '2026-01-29',
        kind: 'hearing',
        note: 'Prosecution requested postponement; documents awaited from forensic lab. Adjourned for 10 days.',
      },
    ];

    const extracted = extractAdjournmentEvents(events, 20500); // 2026-02-15 asOf
    expect(extracted.length).toBe(2);
    expect(extracted[0].party).toBe('petitioner');
    expect(extracted[0].reason).toBe('counsel_absent');
    expect(extracted[1].party).toBe('prosecution');
    expect(extracted[1].reason).toBe('documents_awaited');
  });

  it('enforces CPC Order XVII Rule 1 proviso (maximum 3 adjournments ceiling)', () => {
    const record: CaseRecord = {
      ...baseCase,
      events: [
        {
          on: '2026-01-10',
          kind: 'adjournment',
          adjournment: { requestedBy: 'petitioner', reason: 'counsel_absent', daysGranted: 14 },
        },
        {
          on: '2026-01-25',
          kind: 'adjournment',
          adjournment: { requestedBy: 'petitioner', reason: 'witness_absent', daysGranted: 14 },
        },
        {
          on: '2026-02-10',
          kind: 'adjournment',
          adjournment: { requestedBy: 'petitioner', reason: 'interlocutory_application', daysGranted: 10 },
        },
      ],
    };

    const analysis = analyzeAdjournments(record, '2026-02-15');
    expect(analysis.totalAdjournments).toBe(3);
    expect(analysis.partyBreakdown.petitioner).toBe(3);
    expect(analysis.order17Rule1Exceeded).toBe(true);
    expect(analysis.riskLevel).toBe('CRITICAL');
    expect(analysis.statutoryWarnings.some(w => w.includes('Order XVII Rule 1'))).toBe(true);
    expect(analysis.recommendation.costWarning).toBeDefined();
  });

  it('flags BNSS Section 346 day-to-day violations when repeated counsel absences occur', () => {
    const record: CaseRecord = {
      ...baseCase,
      events: [
        {
          on: '2026-01-10',
          kind: 'adjournment',
          adjournment: { requestedBy: 'petitioner', reason: 'counsel_absent', daysGranted: 25 },
        },
        {
          on: '2026-02-05',
          kind: 'adjournment',
          adjournment: { requestedBy: 'petitioner', reason: 'counsel_absent', daysGranted: 30 },
        },
      ],
    };

    const analysis = analyzeAdjournments(record, '2026-02-15');
    expect(analysis.bnss346DayToDayViolation).toBe(true);
    expect(analysis.statutoryWarnings.some(w => w.includes('BNSS Section 346'))).toBe(true);
  });

  it('recommends realistic postponement dates avoiding overcrowded docket days', () => {
    const scheduledDocket = {
      '2026-03-05': 35, // at maximum capacity
      '2026-03-06': 34, // heavy
      '2026-03-09': 12, // light monday
    };

    const rec = recommendNextHearing(20510, [], {
      maxDailyCases: 35,
      scheduledDocket,
    });

    expect(rec.suggestedDays).toBeGreaterThanOrEqual(4);
    expect(rec.suggestedDays).toBeLessThanOrEqual(21);
    expect(rec.earliestDate).toBeDefined();
    expect(rec.statutoryAdvice.length).toBeGreaterThan(0);
  });
});
