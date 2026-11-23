import { useEffect, useState } from 'react';
import type {
  AdjournmentAnalysis,
  AdjournmentParty,
  AdjournmentReason,
  CaseRecord,
  CourtEvent,
  ISODate,
  Person,
} from '@courtplus/contracts';
import { useApp } from '../lib/context';
import { btn, btnPrimary, errMsg } from './ui';

interface Props {
  caseRecord: CaseRecord;
  person?: Person | null;
  asOf: ISODate;
  onCaseUpdated?: (updated: CaseRecord) => void;
}

const RISK_BADGES: Record<AdjournmentAnalysis['riskLevel'], { label: string; style: string }> = {
  LOW: { label: 'Low Delay Risk', style: 'bg-green-100 text-green-800 border-green-300' },
  MODERATE: { label: 'Moderate Delay Risk', style: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  HIGH: { label: 'High Delay Risk', style: 'bg-orange-100 text-orange-800 border-orange-300' },
  CRITICAL: { label: 'Critical Delay Risk (Ceiling Exceeded)', style: 'bg-red-100 text-red-800 border-red-400 font-bold' },
};

const PARTY_LABELS: Record<AdjournmentParty, string> = {
  petitioner: 'Petitioner / Accused',
  respondent: 'Respondent / Complainant',
  prosecution: 'Prosecution / State',
  court: 'Court / Bench',
  joint: 'Joint Request',
  other: 'Other / Registry',
};

const REASON_LABELS: Record<AdjournmentReason, string> = {
  counsel_absent: 'Counsel Absent / Engaged Elsewere',
  witness_absent: 'Witness Absent / Summons Pending',
  documents_awaited: 'Documents / Case Diary Awaited',
  interlocutory_application: 'Interlocutory Application (IA)',
  settlement_talks: 'Settlement / Lok Adalat Talks',
  bench_unavailable: 'Bench on Leave / Administrative',
  police_report_pending: 'Police Report / FSL Awaited',
  general: 'General Adjournment',
};

export function AdjournmentAnalyzer({ caseRecord, person, asOf, onCaseUpdated }: Props) {
  const { api } = useApp();
  const [analysis, setAnalysis] = useState<AdjournmentAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state for recording an adjournment
  const [party, setParty] = useState<AdjournmentParty>('petitioner');
  const [reason, setReason] = useState<AdjournmentReason>('counsel_absent');
  const [daysGranted, setDaysGranted] = useState(14);
  const [costs, setCosts] = useState<number>(0);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!api?.analyzeAdjournments) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.analyzeAdjournments(caseRecord.id, asOf)
      .then(res => {
        if (active) setAnalysis(res);
      })
      .catch(err => {
        if (active) setError(errMsg(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api, caseRecord.id, asOf, caseRecord.events]);

  const handleRecordAdjournment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person) {
      setError('Cannot record adjournment: person record missing.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const newEvent: CourtEvent = {
        on: asOf,
        kind: 'adjournment',
        note: `${PARTY_LABELS[party]} requested adjournment: ${REASON_LABELS[reason]}. ${justification ? `Reason: ${justification}` : ''}`,
        adjournment: {
          requestedBy: party,
          reason,
          daysGranted,
          costsImposed: costs > 0 ? costs : undefined,
          recordedJustification: justification || undefined,
        },
      };

      const updatedRecord: CaseRecord = {
        ...caseRecord,
        events: [...caseRecord.events, newEvent],
      };

      await api.saveCase(person, updatedRecord);
      setShowAddForm(false);
      setJustification('');
      if (onCaseUpdated) onCaseUpdated(updatedRecord);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Adjournment Analyzer" className="order-5 rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Adjournment (Postponement) Analyzer</h2>
          <p className="text-xs text-slate-500">
            Delay pattern tracking, CPC Order XVII Rule 1 ceiling enforcement & workload-based scheduling.
          </p>
        </div>
        {analysis && (
          <span className={`rounded border px-2.5 py-1 text-xs uppercase tracking-wide ${RISK_BADGES[analysis.riskLevel].style}`}>
            {RISK_BADGES[analysis.riskLevel].label}
          </span>
        )}
      </div>

      {loading && !analysis && <p className="py-4 text-sm text-slate-500">Analyzing postponement records…</p>}
      {error && <p className="my-2 rounded bg-red-50 p-2 text-xs text-red-700">▲ {error}</p>}

      {analysis && (
        <div className="mt-3 space-y-4">
          {/* Headline Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border bg-slate-50 p-2.5 text-center">
              <span className="block text-xs text-slate-500">Total Adjournments</span>
              <strong className="text-xl font-bold text-slate-800">{analysis.totalAdjournments}</strong>
            </div>
            <div className="rounded border bg-slate-50 p-2.5 text-center">
              <span className="block text-xs text-slate-500">Total Delay Incurred</span>
              <strong className="text-xl font-bold text-slate-800">{analysis.totalDelayDays} days</strong>
            </div>
            <div className="rounded border bg-slate-50 p-2.5 text-center">
              <span className="block text-xs text-slate-500">Avg. Delay Span</span>
              <strong className="text-xl font-bold text-slate-800">{analysis.averageAdjournmentSpanDays} days</strong>
            </div>
            <div className={`rounded border p-2.5 text-center ${analysis.order17Rule1Exceeded ? 'bg-red-50 text-red-900 border-red-200' : 'bg-slate-50'}`}>
              <span className="block text-xs text-slate-500">Order XVII R.1 Proviso</span>
              <strong className="text-sm font-bold">
                {analysis.order17Rule1Exceeded ? 'Ceiling Breached (>3)' : 'Within Statutory Limit (≤3)'}
              </strong>
            </div>
          </div>

          {/* Statutory Warnings */}
          {analysis.statutoryWarnings.length > 0 && (
            <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900">
              <strong className="font-semibold">Statutory Compliance Warnings:</strong>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {analysis.statutoryWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Party Breakdown Bars (Order XVII Rule 1 tracking) */}
          <div className="rounded border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Party-Wise Adjournment Counts (Max 3 Allowed)</h3>
              <span className="text-xs text-slate-500">CPC O.17 R.1 Ceiling: 3</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(['petitioner', 'respondent', 'prosecution', 'court'] as AdjournmentParty[]).map(p => {
                const count = analysis.partyBreakdown[p] ?? 0;
                const ratio = Math.min(100, Math.round((count / 3) * 100));
                const isOver = count >= 3 && p !== 'court';
                return (
                  <div key={p} className="rounded bg-slate-50 p-2 text-xs">
                    <div className="flex justify-between font-medium">
                      <span>{PARTY_LABELS[p]}</span>
                      <span className={isOver ? 'font-bold text-red-700' : 'text-slate-600'}>
                        {count} / 3 {isOver && '⚠ EXCEEDED'}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full ${isOver ? 'bg-red-600' : count === 2 ? 'bg-amber-500' : 'bg-blue-600'}`}
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workload-Based Scheduling Recommender */}
          <div className="rounded border border-blue-200 bg-blue-50/60 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-blue-950">Workload-Based Postponement Recommendation</h3>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                analysis.recommendation.docketLoadLevel === 'light' ? 'bg-green-100 text-green-800' :
                analysis.recommendation.docketLoadLevel === 'moderate' ? 'bg-blue-100 text-blue-800' :
                analysis.recommendation.docketLoadLevel === 'heavy' ? 'bg-orange-100 text-orange-800' :
                'bg-red-100 text-red-800'
              }`}>
                {analysis.recommendation.docketLoadLevel} Docket
              </span>
            </div>
            <p className="mt-1 text-xs text-blue-900">
              Rather than an arbitrary 4–6 week routine delay, CourtPlus checks calendar docket capacity and statutory speed limits:
            </p>
            <div className="mt-2.5 flex flex-wrap items-baseline gap-4 rounded bg-white p-2.5 text-xs text-slate-700 border border-blue-100">
              <div>
                <span className="text-slate-500">Earliest Viable Date: </span>
                <strong className="text-blue-900 text-sm">{analysis.recommendation.earliestDate}</strong>
              </div>
              <div>
                <span className="text-slate-500">Recommended Gap: </span>
                <strong className="text-slate-900">{analysis.recommendation.suggestedDays} working days</strong>
              </div>
              {analysis.recommendation.costWarning && (
                <div className="w-full text-red-700 font-medium pt-1">
                  ⚠ {analysis.recommendation.costWarning}
                </div>
              )}
            </div>
            <ul className="mt-2 list-disc pl-4 text-xs text-blue-900 space-y-0.5">
              {analysis.recommendation.statutoryAdvice.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>

          {/* Adjournment Event History */}
          {analysis.events.length > 0 && (
            <div className="rounded border p-3">
              <h3 className="text-sm font-semibold text-slate-700">Recorded Delay History</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="p-1.5">Date</th>
                      <th className="p-1.5">Party</th>
                      <th className="p-1.5">Reason</th>
                      <th className="p-1.5">Days</th>
                      <th className="p-1.5">Costs</th>
                      <th className="p-1.5">Justification / Order Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-700">
                    {analysis.events.map((ev, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-1.5 font-mono">{ev.on}</td>
                        <td className="p-1.5 font-medium">{PARTY_LABELS[ev.party] ?? ev.party}</td>
                        <td className="p-1.5">{REASON_LABELS[ev.reason] ?? ev.reason}</td>
                        <td className="p-1.5">{ev.daysGranted} d</td>
                        <td className="p-1.5">{ev.costsImposed ? `₹${ev.costsImposed}` : '—'}</td>
                        <td className="p-1.5 text-slate-600 max-w-xs truncate">{ev.recordedJustification ?? ev.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action to Record Postponement */}
          <div className="pt-1">
            {!showAddForm ? (
              <button
                type="button"
                className={btn}
                onClick={() => setShowAddForm(true)}
              >
                + Record Judicial Postponement (Adjournment)
              </button>
            ) : (
              <form onSubmit={handleRecordAdjournment} className="rounded border bg-slate-50 p-3 text-xs space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <strong className="font-semibold text-slate-800">Record New Postponement / Adjournment</strong>
                  <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setShowAddForm(false)}>✕ Cancel</button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-slate-600">Requesting Party</span>
                    <select
                      value={party}
                      onChange={e => setParty(e.target.value as AdjournmentParty)}
                      className="mt-1 block w-full rounded border bg-white p-1.5"
                    >
                      {Object.entries(PARTY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-slate-600">Stated Grounds / Reason</span>
                    <select
                      value={reason}
                      onChange={e => setReason(e.target.value as AdjournmentReason)}
                      className="mt-1 block w-full rounded border bg-white p-1.5"
                    >
                      {Object.entries(REASON_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-slate-600">Days Granted (Suggested: {analysis.recommendation.suggestedDays})</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={daysGranted}
                      onChange={e => setDaysGranted(Number(e.target.value))}
                      className="mt-1 block w-full rounded border bg-white p-1.5"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-600">Costs Imposed under BNSS § 346 / CPC O.17 R.1 (₹)</span>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={costs}
                      onChange={e => setCosts(Number(e.target.value))}
                      placeholder="0"
                      className="mt-1 block w-full rounded border bg-white p-1.5"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-slate-600">Judicial Reasons Recorded in Writing (Mandatory per BNSS § 346)</span>
                  <input
                    type="text"
                    value={justification}
                    onChange={e => setJustification(e.target.value)}
                    placeholder="e.g. Witness was summoned but official duty prevented attendance; last opportunity granted."
                    className="mt-1 block w-full rounded border bg-white p-1.5"
                  />
                </label>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={saving} className={btnPrimary}>
                    {saving ? 'Recording…' : 'Record & Enforce Rule Limits'}
                  </button>
                  <button type="button" className={btn} onClick={() => setShowAddForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
