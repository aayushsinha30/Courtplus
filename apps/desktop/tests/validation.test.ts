import { describe, expect, it } from 'vitest';
import type { CaseRecord, Person } from '@courtplus/contracts';
import { argumentSchemas, validateArguments } from '../src/validation';

const person: Person = {
  id: 'fictional-person',
  alias: 'Fictional test alias',
  prisonerType: 'undertrial',
  priorConviction: 'unknown',
  otherHolds: 'no',
  caseIds: [],
};

const record: CaseRecord = {
  id: 'fictional-case',
  personId: person.id,
  charges: [{ act: 'BNS', section: 'test', stage: 'FRAMED', verified: true }],
  custody: [{ kind: 'judicial', start: '2024-02-29', ongoing: true }],
  events: [{ kind: 'remand', on: '2024-02-29' }],
  pendingStatus: 'trial',
};

describe('IPC arguments', () => {
  it('accepts a well-formed person and case', () => {
    expect(validateArguments(argumentSchemas.saveCase, [person, record])).toEqual([person, record]);
  });

  it('rejects a mismatched owner', () => {
    expect(() => validateArguments(argumentSchemas.saveCase, [
      person, { ...record, personId: 'other-fictional-person' },
    ])).toThrow('INVALID_ARGUMENT at 1.personId');
  });

  it('rejects impossible civil dates and invalid nested enums', () => {
    expect(() => validateArguments(argumentSchemas.board, ['2023-02-29'])).toThrow('INVALID_ARGUMENT');
    expect(() => validateArguments(argumentSchemas.saveCase, [
      person, { ...record, events: [{ kind: 'invented', on: '2024-02-29' }] },
    ])).toThrow('INVALID_ARGUMENT at 1.events.0.kind');
  });

  it('requires bytes for a file and rejects unknown properties', () => {
    const bytes = Uint8Array.of(1);
    expect(validateArguments(argumentSchemas.importOrder, [{ name: 'fixture.pdf', bytes }]))
      .toEqual([{ name: 'fixture.pdf', bytes }]);
    expect(() => validateArguments(argumentSchemas.importOrder, [{ name: 'fixture.pdf', bytes: [1] }]))
      .toThrow('INVALID_ARGUMENT');
    expect(() => validateArguments(argumentSchemas.updateCard, ['fictional-card', { unexpected: true }]))
      .toThrow('INVALID_ARGUMENT');
  });

  it('rejects unexpected arguments for zero-argument channels', () => {
    expect(validateArguments(argumentSchemas.role, [])).toEqual([]);
    expect(() => validateArguments(argumentSchemas.role, [null])).toThrow('INVALID_ARGUMENT');
  });
});
