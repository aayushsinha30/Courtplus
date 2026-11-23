import { ui } from '../lib/i18n';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BenchBacklogSummary, JudgeMetric } from '@courtplus/contracts';
import { todayIST, useApp } from '../lib/context';
import { Empty, ErrorNote, Page, errMsg } from '../components/ui';

export function JudgeDashboard() {
  const { api } = useApp();
  const today = todayIST();
  const [asOf, setAsOf] = useState(today);
  const [summary, setSummary] = useState<BenchBacklogSummary | null>(null);
  const [selectedJudge, setSelectedJudge] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.judgeDashboard(asOf, selectedJudge === 'all' ? undefined : selectedJudge)
      .then(res => {
        if (active) setSummary(res);
      })
      .catch(err => {
        if (active) setError(errMsg(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [api, asOf, selectedJudge]);

  const activeJudgeMetric: JudgeMetric | null = useMemo(() => {
    if (!summary || summary.judges.length === 0) return null;
    if (selectedJudge === 'all') {
      // Aggregate metric across all judges
      const aggAging = { under1Year: 0, oneToThreeYears: 0, threeToFiveYears: 0, fiveToTenYears: 0, overTenYears: 0 };
      let totalFiled = 0;
      let totalDisposed = 0;
      let totalActive = 0;
      let totalAdjournments = 0;
      let totalLifespan = 0;

      for (const j of summary.judges) {
        totalFiled += j.totalFiled;
        totalDisposed += j.disposedCases;
        totalActive += j.activeCases;
        totalAdjournments += j.totalAdjournmentsGranted;
        totalLifespan += j.avgCaseLifespanDays * j.totalFiled;
        aggAging.under1Year += j.aging.under1Year;
        aggAging.oneToThreeYears += j.aging.oneToThreeYears;
        aggAging.threeToFiveYears += j.aging.threeToFiveYears;
        aggAging.fiveToTenYears += j.aging.fiveToTenYears;
        aggAging.overTenYears += j.aging.overTenYears;
      }

      // Merge timelines
      const tMap = new Map<string, { filed: number; disposed: number }>();
      for (const j of summary.judges) {
        for (const pt of j.timeline) {
          const entry = tMap.get(pt.date) ?? { filed: 0, disposed: 0 };
          entry.filed += pt.filed;
          entry.disposed += pt.disposed;
          tMap.set(pt.date, entry);
        }
      }

      const timeline = [...tMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({
          date,
          filed: counts.filed,
          disposed: counts.disposed,
          clearanceRate: counts.filed > 0 ? Math.round((counts.disposed / counts.filed) * 100) : 100,
        }));

      return {
        judgeName: 'Entire Bench (All Judges)',
        courtRoom: 'All Courtrooms',
        court: summary.judges[0]?.court ?? 'District Judiciary',
        activeCases: totalActive,
        disposedCases: totalDisposed,
        totalFiled,
        clearanceRate: totalFiled > 0 ? Math.round((totalDisposed / totalFiled) * 1000) / 10 : 0,
        disposalVelocity: Math.max(1, Math.round(totalDisposed * 1.5)),
        avgCaseLifespanDays: totalFiled > 0 ? Math.round(totalLifespan / totalFiled) : 0,
        totalAdjournmentsGranted: totalAdjournments,
        adjournmentRatio: totalDisposed > 0 ? Math.round((totalAdjournments / totalDisposed) * 10) / 10 : totalAdjournments,
        aging: aggAging,
        timeline,
        byCaseType: {},
      };
    }
    return summary.judges.find(j => j.judgeName === selectedJudge) ?? summary.judges[0];
  }, [summary, selectedJudge]);

  const agingChartData = useMemo(() => {
    if (!activeJudgeMetric) return [];
    return [
      { label: '< 1 Year', count: activeJudgeMetric.aging.under1Year, fill: '#10b981' },
      { label: '1–3 Years', count: activeJudgeMetric.aging.oneToThreeYears, fill: '#3b82f6' },
      { label: '3–5 Years', count: activeJudgeMetric.aging.threeToFiveYears, fill: '#f59e0b' },
      { label: '5–10 Years', count: activeJudgeMetric.aging.fiveToTenYears, fill: '#f97316' },
      { label: '> 10 Years', count: activeJudgeMetric.aging.overTenYears, fill: '#ef4444' },
    ];
  }, [activeJudgeMetric]);

  const clearanceTone = (rate: number) => {
    if (rate >= 100) return 'text-green-700 bg-green-50 border-green-200';
    if (rate >= 80) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  return (
    <Page
      title={ui("Judge Performance & Backlog Dashboard")}
      note={ui("Real-time daily filings vs. resolutions analytics, disposal velocity, and statutory NJDG aging distribution.")}
    >
      <ErrorNote error={error} />

      {/* Control Filters Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <span>{ui("Filter Judge / Bench:")}</span>
            <select
              value={selectedJudge}
              onChange={e => setSelectedJudge(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-normal"
            >
              <option value="all">{ui("Entire Bench (All Judges)")}</option>
              {summary?.judges.map(j => (
                <option key={j.judgeName} value={j.judgeName}>
                  {j.judgeName} ({j.courtRoom ?? ui("Courtroom")})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium">
            <span>{ui("As of Date:")}</span>
            <input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm font-normal"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setAsOf(today)}
          className="text-xs text-blue-700 underline hover:text-blue-900"
        >{ui("Reset to Today")}</button>
      </div>

      {loading && !summary && <p className="py-6 text-sm text-slate-500">{ui("Calculating judge performance metrics…")}</p>}

      {summary && summary.totalActiveCases === 0 && summary.totalDisposedCases === 0 && (
        <Empty
          title={ui("No case data recorded yet")}
          hint={ui("Import orders or record case proceedings to populate judge backlog metrics.")}
          to="/import"
          cta={ui("Import an Order")}
        />
      )}

      {activeJudgeMetric && (
        <div className="space-y-4">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className={`rounded-lg border p-4 text-center ${clearanceTone(activeJudgeMetric.clearanceRate)}`}>
              <span className="block text-xs font-semibold uppercase tracking-wider">{ui("Clearance Rate")}</span>
              <strong className="mt-1 block text-3xl font-extrabold">{`${activeJudgeMetric.clearanceRate}%`}</strong>
              <span className="mt-1 block text-xs opacity-90">
                {activeJudgeMetric.clearanceRate >= 100 ? ui("✓ Arrears Reducing") : ui("▲ Below 100% Target")}
              </span>
            </div>

            <div className="rounded-lg border bg-white p-4 text-center shadow-sm">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{ui("Active Docket")}</span>
              <strong className="mt-1 block text-3xl font-extrabold text-slate-800">{activeJudgeMetric.activeCases}</strong>
              <span className="mt-1 block text-xs text-slate-500">{ui("Pending Matters")}</span>
            </div>

            <div className="rounded-lg border bg-white p-4 text-center shadow-sm">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{ui("Disposed Matters")}</span>
              <strong className="mt-1 block text-3xl font-extrabold text-green-700">{activeJudgeMetric.disposedCases}</strong>
              <span className="mt-1 block text-xs text-slate-500">
                {activeJudgeMetric.totalFiled}{" " + ui("Total Instituted")}</span>
            </div>

            <div className="rounded-lg border bg-white p-4 text-center shadow-sm">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">{ui("Adjournment Ratio")}</span>
              <strong className="mt-1 block text-3xl font-extrabold text-blue-900">{activeJudgeMetric.adjournmentRatio}</strong>
              <span className="mt-1 block text-xs text-slate-500">
                {activeJudgeMetric.totalAdjournmentsGranted}{" " + ui("Total Adjournments")}</span>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Chart 1: Filings vs Disposals Trend */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2">
                <h3 className="font-semibold text-slate-800">{ui("Daily Filings vs. Resolutions Velocity")}</h3>
                <p className="text-xs text-slate-500">{ui("Real-time daily inflow vs judicial clearance throughput.")}</p>
              </div>
              <div className="h-64" role="img" aria-label={ui("Line chart comparing instituted filings vs disposed cases")}>
                {activeJudgeMetric.timeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={activeJudgeMetric.timeline}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="filed" name="Instituted / Filed" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="disposed" name="Disposed / Resolved" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">{ui("Sufficient timeline dates will appear as cases progress.")}</div>
                )}
              </div>
            </div>

            {/* Chart 2: NJDG Pendency Aging Pyramid */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2">
                <h3 className="font-semibold text-slate-800">{ui("NJDG Statutory Pendency Aging Breakdown")}</h3>
                <p className="text-xs text-slate-500">{ui("Matches official National Judicial Data Grid aging categories.")}</p>
              </div>
              <div className="h-64" role="img" aria-label={ui("Bar chart showing case aging distribution")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Pending Cases" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Judge Roster Breakdown Table */}
          {summary && summary.judges.length > 1 && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h3 className="mb-2 font-semibold text-slate-800">{ui("Individual Bench Performance Roster")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="p-2">{ui("Judge Name")}</th>
                      <th className="p-2">{ui("Courtroom")}</th>
                      <th className="p-2">{ui("Active Cases")}</th>
                      <th className="p-2">{ui("Disposed")}</th>
                      <th className="p-2">{ui("Clearance Rate")}</th>
                      <th className="p-2">{ui("Adjournments")}</th>
                      <th className="p-2">{ui("Avg Lifespan")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-700">
                    {summary.judges.map(j => (
                      <tr
                        key={j.judgeName}
                        onClick={() => setSelectedJudge(j.judgeName)}
                        className={`cursor-pointer hover:bg-slate-50 ${selectedJudge === j.judgeName ? 'bg-blue-50/70 font-semibold' : ''}`}
                      >
                        <td className="p-2 text-blue-900">{j.judgeName}</td>
                        <td className="p-2 text-slate-500">{j.courtRoom ?? '—'}</td>
                        <td className="p-2">{j.activeCases}</td>
                        <td className="p-2 text-green-700 font-medium">{j.disposedCases}</td>
                        <td className="p-2">
                          <span className={`rounded px-1.5 py-0.5 font-bold ${
                            j.clearanceRate >= 100 ? 'bg-green-100 text-green-800' :
                            j.clearanceRate >= 80 ? 'bg-amber-100 text-amber-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {`${j.clearanceRate}%`}
                          </span>
                        </td>
                        <td className="p-2">{j.totalAdjournmentsGranted}</td>
                        <td className="p-2">{j.avgCaseLifespanDays}{" " + ui("days")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Official Benchmark Comparison Card */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">{ui("National & State Judicial Context (data.gov.in & NJDG Benchmarks)")}</h3>
            <p className="mt-1 text-xs text-slate-600">
              Official figures to contextualize local judicial velocity against nationwide court load:
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded bg-white p-3 border">
                <span className="text-slate-500 block">{ui("District 10+ Year Pendency (India)")}</span>
                <strong className="text-sm font-bold text-slate-900">52,56,293 cases</strong>
                <p className="mt-1 text-[11px] text-slate-500">Source: Open Government Data (data.gov.in), 27 March 2026</p>
              </div>
              <div className="rounded bg-white p-3 border">
                <span className="text-slate-500 block">{ui("District 10+ Year Pendency (Chhattisgarh)")}</span>
                <strong className="text-sm font-bold text-slate-900">1,166 cases</strong>
                <p className="mt-1 text-[11px] text-slate-500">Source: NJDG State Return, 27 March 2026</p>
              </div>
              <div className="rounded bg-white p-3 border">
                <span className="text-slate-500 block">{ui("High Court Judge Vacancies (India / CG)")}</span>
                <strong className="text-sm font-bold text-slate-900">308 vacant / 7 in CG</strong>
                <p className="mt-1 text-[11px] text-slate-500">Source: Rajya Sabha returns, 30 January 2026</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
