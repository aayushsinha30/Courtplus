import type { Alert, TraceStep } from '@courtplus/contracts';
import { nalsa, poor, postBail, statute } from './authority.js';
import { addMonths, BNSS_START, day, iso, visibleDate } from './dates.js';
import { evidence, fractionReached, recordDate } from './facts.js';
import type { Interval } from './dates.js';
import { usesCrPCProcedure } from './remand.js';
import type { EngineCaseRecord, EnginePerson } from './facts.js';
import { maxMonths, scheduleBailability } from './offences.js';
import type { ResolvedCharges } from './offences.js';

const hardExclusions = new Set(['PC_ACT', 'PMLA', 'NDPS', 'UAPA']);
const discretionarySections = new Set([
  'IPC:121', 'IPC:121A', 'IPC:304B', 'IPC:370', 'IPC:370A', 'IPC:375', 'IPC:376', 'IPC:376A',
  'IPC:376AB', 'IPC:376B', 'IPC:376C', 'IPC:376D', 'IPC:376DA', 'IPC:376DB', 'IPC:376E',
  'BNS:63', 'BNS:64', 'BNS:65', 'BNS:66', 'BNS:67', 'BNS:68', 'BNS:70', 'BNS:71', 'BNS:80',
  'BNS:113', 'BNS:147', 'BNS:148', 'BNS:143', 'BNS:144'
]);
const schemeRevision = day('2025-12-02')!;
const postBailOrder = day('2023-01-31')!;

export function followUp(
  c: EngineCaseRecord, person: EnginePerson, charges: ResolvedCharges, asOf: number, inCustody: boolean,
  caseCustody: boolean, firstCustody: number | undefined, otherHolds: boolean, undertrial: boolean
) {
  const alerts: Alert[] = [];
  const released = recordDate(c, 'releasedOn', 'released', asOf);
  const granted = recordDate(c, 'bailGrantedOn', 'bail_granted', asOf);
  const bonds = evidence(c.evidence?.bailBondsFurnished, asOf) ?? 'unknown';
  const financialBarrier = evidence(c.evidence?.financialBarrier, asOf) ?? 'unknown';
  const bailable = evidence(c.evidence?.bailable, asOf) ?? scheduleBailability(charges);
  const arrested = visibleDate(evidence(c.evidence?.arrestedOn, asOf), asOf);
  const outstanding = inCustody && granted !== undefined && (released === undefined || released < granted);
  const holds = otherHolds ? ' Verify all current holds and other pending cases first.' : '';
  const usesBnss = !usesCrPCProcedure(c, recordDate(c, 'firstRemandOn', 'remand', asOf), asOf);
  const routes = usesBnss ? [statute.bnss483, statute.bnss484] : [];
  if (asOf >= postBailOrder && outstanding && asOf >= granted + 7) {
    alerts.push({
      kind: 'POST_BAIL_7_DAYS', dueOn: iso(granted + 7), authority: [postBail],
      message: 'Seven days since bail grant without recorded release. Superintendent to inform the DLSA Secretary.' + holds
    });
  }
  if (asOf >= postBailOrder && outstanding && bonds === 'no' && asOf >= addMonths(granted, 1)) {
    alerts.push({
      kind: 'POST_BAIL_1_MONTH', dueOn: iso(addMonths(granted, 1)), authority: [postBail, ...routes],
      message: 'Bail bonds remain unfurnished after one calendar month. The granting court may consider relaxing conditions.' + holds
    });
  }
  if (undertrial && inCustody && usesBnss && bailable === 'yes' && bonds === 'no'
    && arrested !== undefined && asOf >= arrested + 7) {
    alerts.push({
      kind: 'S478_INDIGENCE', dueOn: iso(arrested + 7), authority: [statute.bnss478, ...routes],
      message: 'Bailable case with bail bond unfurnished after a week from arrest. Review the presumption of indigence and release on bond.' + holds
    });
  }
  if (asOf >= schemeRevision && undertrial && outstanding && asOf >= granted + 7 && financialBarrier === 'yes') {
    const hard = charges.some(({ charge }) => hardExclusions.has(charge.act));
    const discretionary = charges.some(({ charge }) => charge.act === 'POCSO'
      || discretionarySections.has(charge.act + ':' + /^\d+[a-z]?/i.exec(charge.section.trim())?.[0].toUpperCase()));
    const uncertain = !charges.length || charges.some(({ row }) => !row);
    if (hard) alerts.push({
      kind: 'POOR_PRISONERS_EXCLUDED', message: 'The recorded special Act falls in the scheme’s exclusions.', authority: [poor]
    });
    else if (discretionary) alerts.push({
      kind: 'POOR_PRISONERS_DISCRETION',
      message: 'Committee discretion: lawyer review.' + holds,
      authority: [poor]
    });
    else if (!uncertain && bonds === 'no' && !otherHolds) alerts.push({
      kind: 'POOR_PRISONERS_REFERRAL',
      message: 'Refer for DLSA verification of the financial barrier and district Empowered Committee assessment.',
      authority: [poor]
    });
  }

  const courtUpdates = c.events.map(event => ({ kind: event.kind, when: visibleDate(event.on, asOf) }));
  const roster = person.evidence?.jailRoster;
  const rosterOn = evidence(roster, asOf) === 'yes' ? visibleDate(roster?.on, asOf) : undefined;
  const heldAfter = (date: number) => date < asOf && (caseCustody || (rosterOn ?? -Infinity) > date);
  const mismatch = courtUpdates.some(event => event.when !== undefined && heldAfter(event.when)
    && ['acquitted', 'bail_granted', 'released'].includes(event.kind)
    && (event.kind === 'released' || released === undefined || released < event.when))
    || outstanding && heldAfter(granted);
  if (inCustody && mismatch) alerts.push({
    kind: 'COURT_JAIL_MISMATCH', message: 'Court and jail records disagree. Verify order, identity and all current holds.'
  });
  const recentCutoff = asOf - 180;
  const knownCourtDates = [...courtUpdates.map(event => event.when), granted, released,
    recordDate(c, 'firstRemandOn', 'remand', asOf), recordDate(c, 'chargesheetOn', 'chargesheet', asOf)];
  if (inCustody && !knownCourtDates.some(when => when !== undefined && when > recentCutoff)
    && (firstCustody === undefined || firstCustody <= recentCutoff)) {
    alerts.push({
      kind: 'NO_COURT_UPDATE_180', message: 'No recorded court update for 180 days. Verify the current case status.',
      ...(knownCourtDates.some(when => when !== undefined) && {
        dueOn: iso(Math.max(...knownCourtDates.filter(when => when !== undefined)) + 180)
      })
    });
  }
  const trace: TraceStep = {
    id: 'follow-up', label: 'Bail terms and court/jail records',
    inputs: {
      grantDate: granted === undefined ? null : iso(granted),
      releaseDate: released === undefined ? null : iso(released),
      arrestDate: arrested === undefined ? null : iso(arrested),
      bondsFurnished: bonds, financialBarrier, bailable, inCustody, otherHolds,
      courtEvents: courtUpdates.flatMap(event => event.when === undefined ? [] : [{ kind: event.kind, on: iso(event.when) }])
    },
    operation: 'Check arrest and bail-grant timelines independently. Compare court dates with continued custody.',
    result: alerts.map(alert => alert.kind).join(', ') || 'No follow-up alert supported by the recorded facts.',
    authority: [...new Set(alerts.flatMap(alert => alert.authority ?? []))]
  };
  return { alerts, trace, bailable, outstanding, bonds };
}

export function nalsaCategories(
  c: EngineCaseRecord, person: EnginePerson, charges: ResolvedCharges, asOf: number,
  countedDays: number, maximum: number | undefined, undertrial: boolean, inCustody: boolean,
  rawCustody: Interval[], bail: ReturnType<typeof followUp>, defaultBailDue: boolean
) {
  const categories: number[] = [];
  const facts = c.evidence;
  const months = maxMonths(charges);
  const note = (category: number, supported: boolean) => { if (supported) categories.push(category); };
  const age = evidence(person.evidence?.ageYears, asOf);
  const firstEvidence = visibleDate(evidence(facts?.magistrateTrialFirstEvidence, asOf), asOf);
  if (undertrial && inCustody) {
    note(1, fractionReached(countedDays, maximum, 2));
    note(2, asOf >= BNSS_START && person.priorConviction === 'no' && fractionReached(countedDays, maximum, 3));
    note(3, bail.outstanding && bail.bonds === 'no');
    note(4, evidence(facts?.compoundable, asOf) === 'yes');
    note(5, bail.bailable === 'yes');
    note(6, evidence(facts?.probationCandidate, asOf) === 'yes');
    note(8, defaultBailDue);
    note(9, months !== undefined && months > 0 && months <= 24);
    note(10, evidence(facts?.preventiveDetention, asOf) === 'yes');
    note(11, evidence(person.evidence?.sickOrInfirm, asOf) === 'yes');
    note(12, person.woman === 'yes');
    note(13, person.priorConviction === 'no' && age !== undefined && age >= 18 && age <= 21
      && months !== undefined && months < 84 && fractionReached(countedDays, maximum, 4));
    note(14, person.mentalIllness === 'yes');
    note(15, c.pendingStatus === 'trial' && bail.bailable === 'no' && firstEvidence !== undefined && asOf >= firstEvidence + 60
      && rawCustody.some(interval => interval.start <= firstEvidence && interval.end >= firstEvidence + 60));
    note(16, person.ageOver70 === 'yes' || age !== undefined && age >= 70);
  }
  note(7, inCustody && evidence(facts?.sentenceCompletedOrRemission, asOf) === 'yes');
  categories.sort((a, b) => a - b);
  const trace: TraceStep = {
    id: 'nalsa', label: 'NALSA UTRC tags',
    inputs: { age: age ?? null, countedDays, maximum: maximum ?? null, inCustody },
    operation: 'Apply the 16-category UTRC checklist to supported facts and thresholds.',
    result: categories.join(', ') || 'No category supported by the recorded facts.',
    authority: categories.includes(15) && asOf >= BNSS_START ? [nalsa, statute.bnss480_6] : [nalsa]
  };
  return { categories, trace };
}
