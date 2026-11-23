import type {
  AdjournmentAnalysis,
  AdjournmentDetail,
  AdjournmentEvent,
  AdjournmentParty,
  AdjournmentReason,
  AdjournmentRecommendation,
  CaseRecord,
  CourtEvent,
  ISODate,
} from '@courtplus/contracts';
import { bnss346, order17Rule1 } from './authority.js';
import { day, iso } from './dates.js';

export interface DocketCapacity {
  maxDailyCases?: number;
  scheduledDocket?: Record<ISODate, number>;
}

const DEFAULT_MAX_DAILY_CASES = 35;

function parseParty(raw?: string): AdjournmentParty {
  const normalized = (raw ?? '').toLowerCase();
  if (normalized.includes('prosecut') || normalized.includes('state') || normalized.includes('police')) return 'prosecution';
  if (normalized.includes('petition') || normalized.includes('applicant') || normalized.includes('accused')) return 'petitioner';
  if (normalized.includes('respond') || normalized.includes('complainant')) return 'respondent';
  if (normalized.includes('bench') || normalized.includes('court') || normalized.includes('presiding')) return 'court';
  if (normalized.includes('joint') || normalized.includes('both')) return 'joint';
  return 'other';
}

function parseReason(raw?: string): AdjournmentReason {
  const normalized = (raw ?? '').toLowerCase();
  if (normalized.includes('counsel') || normalized.includes('lawyer') || normalized.includes('advocate')) return 'counsel_absent';
  if (normalized.includes('witness') || normalized.includes('deponent')) return 'witness_absent';
  if (normalized.includes('document') || normalized.includes('record') || normalized.includes('file')) return 'documents_awaited';
  if (normalized.includes('application') || normalized.includes('ia') || normalized.includes('interlocutory')) return 'interlocutory_application';
  if (normalized.includes('settle') || normalized.includes('compromise') || normalized.includes('mediation')) return 'settlement_talks';
  if (normalized.includes('bench') || normalized.includes('leave') || normalized.includes('unavailable')) return 'bench_unavailable';
  if (normalized.includes('chargesheet') || normalized.includes('report') || normalized.includes('challan')) return 'police_report_pending';
  return 'general';
}

export function extractAdjournmentEvents(events: CourtEvent[], asOfNumber: number): AdjournmentEvent[] {
  const list: AdjournmentEvent[] = [];
  const sorted = [...events].sort((a, b) => (day(a.on) ?? 0) - (day(b.on) ?? 0));

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const eventDayNum = day(e.on);
    if (eventDayNum === undefined || eventDayNum > asOfNumber) continue;

    const isAdjournment = e.kind === 'adjournment'
      || Boolean(e.adjournment)
      || (e.kind === 'hearing' && /adjourn|postpone|deferred|next hearing/i.test(e.note ?? ''));

    if (!isAdjournment) continue;

    const nextEvent = sorted[i + 1];
    const nextDayNum = nextEvent ? day(nextEvent.on) : undefined;
    const computedDays = nextDayNum !== undefined && nextDayNum > eventDayNum
      ? nextDayNum - eventDayNum
      : (e.adjournment?.daysGranted ?? 14);

    const party = e.adjournment?.requestedBy ?? parseParty(e.note);
    const reason = e.adjournment?.reason ?? parseReason(e.note);

    list.push({
      on: e.on,
      party,
      reason,
      daysGranted: e.adjournment?.daysGranted ?? computedDays,
      costsImposed: e.adjournment?.costsImposed,
      recordedJustification: e.adjournment?.recordedJustification ?? e.note,
      note: e.note,
    });
  }
  return list;
}

export function recommendNextHearing(
  asOfNumber: number,
  events: AdjournmentEvent[],
  docket?: DocketCapacity,
): AdjournmentRecommendation {
  const maxCapacity = docket?.maxDailyCases ?? DEFAULT_MAX_DAILY_CASES;
  const scheduled = docket?.scheduledDocket ?? {};

  // Find shortest viable working gap (aim for 7-14 days instead of routine 30-45 days)
  let bestDayOffset = 7;
  let lowestLoad = Infinity;

  for (let offset = 4; offset <= 21; offset++) {
    const candidateDay = asOfNumber + offset;
    const candidateIso = iso(candidateDay);
    const dateObj = new Date(candidateDay * 86_400_000);
    const dayOfWeek = dateObj.getUTCDay();

    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const currentLoad = scheduled[candidateIso] ?? Math.floor(maxCapacity * 0.5);
    if (currentLoad < lowestLoad && currentLoad < maxCapacity) {
      lowestLoad = currentLoad;
      bestDayOffset = offset;
    }
  }

  const earliestDate = iso(asOfNumber + bestDayOffset);
  const loadRatio = lowestLoad / maxCapacity;
  const docketLoadLevel: AdjournmentRecommendation['docketLoadLevel'] =
    loadRatio >= 0.9 ? 'critical' : loadRatio >= 0.7 ? 'heavy' : loadRatio >= 0.4 ? 'moderate' : 'light';

  const advice: string[] = [];
  const counselAbsences = events.filter(e => e.reason === 'counsel_absent').length;
  if (counselAbsences >= 2) {
    advice.push('Counsel absence recorded repeatedly. Proviso to BNSS s.346(2) bars adjournment solely for pleader engagement in another court.');
  }

  const witnessDelays = events.filter(e => e.reason === 'witness_absent').length;
  if (witnessDelays >= 1) {
    advice.push('Witness in attendance must be examined same day under BNSS s.346(1) unless extraordinary reasons recorded.');
  }

  advice.push(`Recommended timeframe of ${bestDayOffset} days preserves day-to-day statutory momentum without exceeding the courtroom capacity of ${maxCapacity} matters/day.`);

  return {
    earliestDate,
    suggestedDays: bestDayOffset,
    docketLoadLevel,
    statutoryAdvice: advice,
    justificationRequired: events.length >= 2,
    costWarning: events.length >= 3 ? 'Adjournment cost imposition recommended under CPC Order XVII Rule 1(2) / BNSS Section 346(2).' : undefined,
  };
}

export function analyzeAdjournments(
  record: CaseRecord,
  asOf: ISODate,
  docket?: DocketCapacity,
): AdjournmentAnalysis {
  const asOfNum = day(asOf) ?? (day(record.orderDate) ?? 0);
  const events = extractAdjournmentEvents(record.events, asOfNum);

  const partyBreakdown: Record<AdjournmentParty, number> = {
    prosecution: 0,
    petitioner: 0,
    respondent: 0,
    court: 0,
    joint: 0,
    other: 0,
  };

  const reasonsBreakdown: Record<AdjournmentReason, number> = {
    counsel_absent: 0,
    witness_absent: 0,
    documents_awaited: 0,
    interlocutory_application: 0,
    settlement_talks: 0,
    bench_unavailable: 0,
    police_report_pending: 0,
    general: 0,
  };

  let totalDelayDays = 0;
  for (const e of events) {
    partyBreakdown[e.party] = (partyBreakdown[e.party] ?? 0) + 1;
    reasonsBreakdown[e.reason] = (reasonsBreakdown[e.reason] ?? 0) + 1;
    totalDelayDays += e.daysGranted;
  }

  const totalAdjournments = events.length;
  const averageAdjournmentSpanDays = totalAdjournments > 0
    ? Math.round(totalDelayDays / totalAdjournments)
    : 0;

  // Statutory evaluation
  const statutoryWarnings: string[] = [];
  let order17Rule1Exceeded = false;

  for (const [p, count] of Object.entries(partyBreakdown)) {
    if (count >= 3 && p !== 'court' && p !== 'joint') {
      order17Rule1Exceeded = true;
      statutoryWarnings.push(
        `CPC Order XVII Rule 1 ceiling reached: Party '${p}' has been granted ${count} adjournments (statutory maximum is 3). Reason: ${order17Rule1.text}`
      );
    }
  }

  const bnss346DayToDayViolation = totalAdjournments >= 3
    || averageAdjournmentSpanDays > 21
    || reasonsBreakdown.counsel_absent >= 2;

  if (bnss346DayToDayViolation) {
    statutoryWarnings.push(
      `BNSS Section 346 notice: Criminal proceedings require day-to-day progress. Repeated postponements (${totalAdjournments} total, avg ${averageAdjournmentSpanDays} days) contradict statutory speed. Reason: ${bnss346.text}`
    );
  }

  // Risk level
  let riskLevel: AdjournmentAnalysis['riskLevel'] = 'LOW';
  if (order17Rule1Exceeded || totalAdjournments >= 5 || totalDelayDays >= 90) {
    riskLevel = 'CRITICAL';
  } else if (totalAdjournments >= 3 || totalDelayDays >= 45) {
    riskLevel = 'HIGH';
  } else if (totalAdjournments >= 2 || totalDelayDays >= 20) {
    riskLevel = 'MODERATE';
  }

  const recommendation = recommendNextHearing(asOfNum, events, docket);

  return {
    caseId: record.id,
    caseNo: record.caseNo ?? record.cnr,
    court: record.court,
    judgeName: record.judgeName,
    totalAdjournments,
    totalDelayDays,
    averageAdjournmentSpanDays,
    partyBreakdown,
    reasonsBreakdown,
    order17Rule1Exceeded,
    bnss346DayToDayViolation,
    riskLevel,
    events,
    recommendation,
    statutoryWarnings,
  };
}
