import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '@courtplus/contracts';
import { classifyAging, computeJudgePerformance, OFFICIAL_NJDG_BENCHMARKS } from '../src/judge-analytics.js';

describe('Judge Performance & Backlog Analytics engine', () => {
  it('classifies cases into NJDG statutory aging buckets correctly', () => {
    expect(classifyAging(120)).toBe('under1Year');
    expect(classifyAging(400)).toBe('oneToThreeYears');
    expect(classifyAging(1200)).toBe('threeToFiveYears');
    expect(classifyAging(2500)).toBe('fiveToTenYears');
    expect(classifyAging(3800)).toBe('overTenYears'); // > 10 years
  });

  it('computes clearance rate and disposal metrics across judges', () => {
    const cases: CaseRecord[] = [
      {
        id: 'case-j1-1',
        personId: 'p-1',
        caseNo: 'SC/01/2025',
        judgeName: 'Judge Anita Roy',
        courtRoom: 'Room 3',
        court: 'Raipur Sessions',
        charges: [],
        custody: [],
        events: [{ on: '2025-01-01', kind: 'chargesheet' }],
        pendingStatus: 'disposed',
        filingDate: '2025-01-01',
        disposalDate: '2025-06-01',
      },
      {
        id: 'case-j1-2',
        personId: 'p-2',
        caseNo: 'SC/02/2025',
        judgeName: 'Judge Anita Roy',
        courtRoom: 'Room 3',
        court: 'Raipur Sessions',
        charges: [],
        custody: [],
        events: [{ on: '2025-02-01', kind: 'chargesheet' }],
        pendingStatus: 'trial',
        filingDate: '2025-02-01',
      },
      {
        id: 'case-j2-1',
        personId: 'p-3',
        caseNo: 'SC/10/2024',
        judgeName: 'Judge Vikram Seth',
        courtRoom: 'Room 5',
        court: 'Raipur Sessions',
        charges: [],
        custody: [],
        events: [{ on: '2024-01-01', kind: 'chargesheet' }],
        pendingStatus: 'trial',
        filingDate: '2024-01-01',
      },
    ];

    const summary = computeJudgePerformance(cases, '2026-03-01');
    expect(summary.totalJudges).toBe(2);
    expect(summary.totalActiveCases).toBe(2);
    expect(summary.totalDisposedCases).toBe(1);

    const judgeAnita = summary.judges.find(j => j.judgeName === 'Judge Anita Roy');
    expect(judgeAnita).toBeDefined();
    expect(judgeAnita?.activeCases).toBe(1);
    expect(judgeAnita?.disposedCases).toBe(1);
    expect(judgeAnita?.clearanceRate).toBe(50); // 1 disposed out of 2 filed
    expect(judgeAnita?.courtRoom).toBe('Room 3');

    const judgeVikram = summary.judges.find(j => j.judgeName === 'Judge Vikram Seth');
    expect(judgeVikram?.clearanceRate).toBe(0);
    expect(judgeVikram?.aging.oneToThreeYears).toBe(1);
  });

  it('includes official data.gov.in benchmarks for national and state comparison', () => {
    const summary = computeJudgePerformance([], '2026-03-01');
    expect(summary.stateNjdg10YearComparison.district10YearPending).toBe(5256293);
    expect(summary.stateNjdg10YearComparison.chhattisgarh10YearPending).toBe(1166);
    expect(OFFICIAL_NJDG_BENCHMARKS.hcPendingIndia).toBe(6396737);
    expect(OFFICIAL_NJDG_BENCHMARKS.hcJudgeVacanciesChhattisgarh).toBe(7);
  });
});
