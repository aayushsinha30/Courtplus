import type { HearingListItem, HearingSummary, SummarySentence } from '@courtplus/contracts';
import { t } from '../lib/i18n';
import { clock, hearingBridge } from './hearing-tools';

type HearingBreakdown = { recordingId: string; startedAt: string; version: number; summary: HearingSummary };
export type HearingBreakdownResult = { hearings: HearingBreakdown[]; unavailable: boolean };

const hearingDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' });

export async function loadHearingBreakdowns(caseId: string): Promise<HearingBreakdownResult> {
  const hearing = hearingBridge();
  if (!hearing) return { hearings: [], unavailable: false };
  const hearings: HearingBreakdown[] = [];
  let unavailable = false;
  let recordings: HearingListItem[];
  try {
    recordings = (await hearing.list()).filter(item => item.caseId === caseId && item.state === 'recorded');
  } catch {
    return { hearings, unavailable: true };
  }
  for (const recording of recordings) {
    try {
      const signed = (await hearing.transcripts(recording.id))
        .filter(version => version.recordingId === recording.id && version.receipt)
        .sort((a, b) => b.version - a.version)[0];
      if (!signed) continue;
      const summary = await hearing.summary(recording.id, signed.version);
      if (summary.basedOnVersion !== signed.version) {
        unavailable = true;
        continue;
      }
      hearings.push({ recordingId: recording.id, startedAt: recording.startedAt, version: signed.version, summary });
    } catch {
      unavailable = true;
    }
  }
  return { hearings: hearings.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)), unavailable };
}

function groupExcerpts(sentences: SummarySentence[]) {
  const groups = [
    { label: t('track.hearing.dates', 'Dates or postponements mentioned'), keywords: ['next date', 'adjourned'], excerpts: [] as SummarySentence[] },
    { label: t('track.hearing.directions', 'Orders or directions mentioned'), keywords: ['order'], excerpts: [] as SummarySentence[] },
    { label: t('track.hearing.evidence', 'Evidence or witnesses mentioned'), keywords: ['evidence', 'witness'], excerpts: [] as SummarySentence[] },
    { label: t('track.hearing.provisions', 'Laws mentioned'), keywords: ['section'], excerpts: [] as SummarySentence[] },
  ];
  const other = { label: t('track.hearing.other', 'Other points mentioned'), excerpts: [] as SummarySentence[] };
  for (const sentence of sentences) {
    const group = groups.find(item => item.keywords.some(keyword => sentence.keywords.includes(keyword))) ?? other;
    group.excerpts.push(sentence);
  }
  return [...groups, other].filter(group => group.excerpts.length);
}

export function HearingBreakdowns({ result }: { result: HearingBreakdownResult | undefined }) {
  return <section className="mt-4 grid gap-2" aria-label={t('track.hearing.summaries', 'Hearing breakdowns')}>
    <h3 className="font-semibold">{t('track.hearing.summaries', 'Hearing breakdowns')}</h3>
    {result === undefined && <p role="status">{t('track.hearing.loading', 'Checking for signed hearing transcripts…')}</p>}
    {result?.unavailable && <p role="status">{t('track.hearing.unavailable', 'Some hearing breakdowns could not be loaded. The recorded case history is still shown above.')}</p>}
    {result && !result.unavailable && !result.hearings.length &&
      <p className="text-sm">{t('track.hearing.noSummaries', 'No signed hearing transcript is available here for this case.')}</p>}
    {Boolean(result?.hearings.length) && <p className="text-sm">
      {t('track.hearing.source', 'These excerpts come from signed transcripts and are grouped automatically. Check the official court order for decisions and deadlines.')}
    </p>}
    {result?.hearings.map((item, index) => {
      const date = new Date(item.startedAt);
      const groups = groupExcerpts(item.summary.sentences);
      return <details key={item.recordingId} className="rounded border p-3" open={index === 0}>
        <summary className="font-medium">
          {t('track.hearing.hearing', 'Hearing')} · <time dateTime={item.startedAt}>
            {Number.isNaN(date.getTime()) ? item.startedAt : hearingDate.format(date)}
          </time> · {t('track.hearing.version', 'Signed transcript version')} {item.version}
        </summary>
        {groups.length ? <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {groups.map(group => <div key={group.label}>
            <h4 className="font-semibold">{group.label}</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {group.excerpts.map((sentence, excerptIndex) => <li key={sentence.segmentId + '-' + excerptIndex}>
                <span className="text-slate-600"><span className="sr-only">{t('track.hearing.offset', 'Elapsed recording time')}{' '}</span>{clock(sentence.startMs)}</span>{' '}
                <q>{sentence.text}</q>
              </li>)}
            </ul>
          </div>)}
        </div> : <p className="mt-2 text-sm">{t('track.hearing.empty', 'No excerpts were selected from this transcript.')}</p>}
      </details>;
    })}
  </section>;
}
