import type { Alert, Charge, ScreeningResult } from '@courtplus/contracts';
import type { DatedEvidence, EngineCaseRecord, EnginePerson } from '../src/index.js';
import { screen } from '../src/index.js';

// All people, orders and events in this directory are fictional.
export const source = { docId: 'fictional-order', page: 1 };
export const fact = <T>(value: T, on = '2025-01-01'): DatedEvidence<T> => ({ on, value, source });
export const fir = (section = '323', act: Charge['act'] = 'IPC'): Charge =>
  ({ act, section, stage: 'FIR', verified: true, source });
export const person = (overrides: Partial<EnginePerson> = {}): EnginePerson => ({
  id: 'fictional-prisoner', alias: 'Fictional Accused', prisonerType: 'undertrial',
  priorConviction: 'no', otherHolds: 'no', caseIds: ['fictional-case'], ...overrides
});
export const record = (overrides: Partial<EngineCaseRecord> = {}): EngineCaseRecord => ({
  id: 'fictional-case', personId: 'fictional-prisoner', charges: [fir()],
  firstRemandOn: '2025-01-01', custody: [{ kind: 'judicial', start: '2025-01-01', ongoing: true }],
  events: [{ on: '2025-01-01', kind: 'remand', source }], pendingStatus: 'trial', ...overrides
});
export function run(
  asOf: string, c: Partial<EngineCaseRecord> = {}, p: Partial<EnginePerson> = {}, others: EngineCaseRecord[] = []
) {
  return screen(person(p), [record(c), ...others], 'fictional-case', asOf);
}
export function alert(result: ScreeningResult, kind: Alert['kind']) {
  return result.alerts.find(value => value.kind === kind);
}
