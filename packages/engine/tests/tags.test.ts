import { describe, expect, it } from 'vitest';
import { fact, fir, record, run } from './fixtures.js';

describe('UTRC and Antil golden cases', () => {
  it('adds both custody categories when a first-time offender reaches half', () => {
    // Day 183 reaches half of 365, and already passed the one-third threshold on day 122.
    const result = run('2025-07-02');
    expect(result.nalsaCategories).toEqual(expect.arrayContaining([1, 2]));
  });

  it('tags surety, compoundability, bailability, probation and personal facts when evidenced', () => {
    // IPC 323 is bailable with 12 months maximum. At 38 days neither custody threshold is met.
    const result = run('2025-02-07', {
      bailGrantedOn: '2025-01-31',
      evidence: { bailBondsFurnished: fact('no', '2025-02-01'), compoundable: fact('yes'), probationCandidate: fact('yes') }
    }, { woman: 'yes', mentalIllness: 'yes', ageOver70: 'yes', evidence: { sickOrInfirm: fact('yes') } });
    expect(result.nalsaCategories).toEqual([3, 4, 5, 6, 9, 11, 12, 14, 16]);
  });

  it('tags sentence completion for a detained convict appellant', () => {
    // No undertrial fraction applies. A dated remission record independently supplies category 7.
    const result = run('2025-02-07', { pendingStatus: 'appeal', evidence: { sentenceCompletedOrRemission: fact('yes') } },
      { prisonerType: 'convict_appellant' });
    expect(result.nalsaCategories).toEqual([7]);
  });

  it('requires the age and quarter-service conditions for category 13', () => {
    // Ceil(365/4) = 92. Jan–Mar = 90. A 21-year-old crosses on Apr 2, and age 22 fails.
    expect(run('2025-04-01', {}, { evidence: { ageYears: fact(21) } }).nalsaCategories).not.toContain(13);
    expect(run('2025-04-02', {}, { evidence: { ageYears: fact(21) } }).nalsaCategories).toContain(13);
    expect(run('2025-04-02', {}, { evidence: { ageYears: fact(22) } }).nalsaCategories).not.toContain(13);
  });

  it('tags documented preventive detention', () => {
    // One dated detention order supports category 10; a future entry is outside the record on this date.
    expect(run('2025-02-01', { evidence: { preventiveDetention: fact('yes') } }).nalsaCategories).toContain(10);
    expect(run('2025-02-01', { evidence: { preventiveDetention: fact('yes', '2025-02-02') } }).nalsaCategories).not.toContain(10);
  });

  it('requires a full 60 days of detention for category 15', () => {
    // Jan 1 to Mar 2 is 60 elapsed days. One interim-bail day gives only 59 in that period.
    const c = record({ charges: [fir('379')], evidence: { magistrateTrialFirstEvidence: fact('2025-01-01') } });
    expect(run('2025-03-01', c).nalsaCategories).not.toContain(15);
    expect(run('2025-03-02', c).nalsaCategories).toContain(15);
    expect(run('2025-03-02', { ...c, custody: [...c.custody, { kind: 'interim_bail', start: '2025-02-01', end: '2025-02-02' }] })
      .nalsaCategories).not.toContain(15);
  });

  it('tags age 70 inclusively', () => {
    // Category 16 starts at 70; 69 is one year short.
    expect(run('2025-02-01', {}, { evidence: { ageYears: fact(69) } }).nalsaCategories).not.toContain(16);
    expect(run('2025-02-01', {}, { evidence: { ageYears: fact(70) } }).nalsaCategories).toContain(16);
  });

  it('distinguishes Antil A, B and D around seven years', () => {
    // IPC 420 is seven years and shifts A to D if economic character is supported; IPC 306 is ten, hence B.
    expect(run('2025-02-01', { charges: [fir('420')] }).antilCategory).toBe('A');
    expect(run('2025-02-01', { charges: [fir('306')] }).antilCategory).toBe('B');
    expect(run('2025-02-01', { charges: [fir('420')], evidence: { economicOffence: fact('yes') } }).antilCategory).toBe('D');
  });

  it('does not tag every NDPS quantity as a twin-condition offence', () => {
    // Section 22(a) is small with one year maximum; section 22(c) is commercial and triggers section 37.
    expect(run('2025-02-01', { charges: [fir('22(a)', 'NDPS')] }).antilCategory).toBe('A');
    expect(run('2025-02-01', { charges: [fir('22(c)', 'NDPS')] }).antilCategory).toBe('C');
  });
});
