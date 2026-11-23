import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HINT_LABEL, RESEARCH_INSTALLING, type CaseRecord, type CourtPlusApi, type HearingApi, type PrecedentHit, type ResearchApi,
} from '@courtplus/contracts';
import india from '../../../../data/stats/india.json';
import { App } from '../App';
import { backlogFigures } from '../components/IndiaBacklog';
import { AppProvider } from '../lib/context';
import { caseHintText, formatCitation, highlight, queryTerms, splitSentences } from '../lib/research';
import { roleGroup, setRoleOverride } from '../lib/roles';
import { CaseView } from '../screens/CaseView';
import { Research } from '../screens/Research';
import { adviseFor, RightsAdvisor } from '../screens/RightsAdvisor';
import { ECOURTS_CASE_STATUS, findCase, TrackCase } from '../screens/TrackCase';

// Fictional fixtures only.
const fictionalCase: CaseRecord = {
  id: 'fictional-c7', personId: 'fictional-p7', caseNo: 'FICTIONAL 7/2026', court: 'Fictional Sessions Court',
  charges: [{ act: 'IPC', section: '379', stage: 'FIR', verified: false }],
  custody: [], events: [{ on: '2026-01-05', kind: 'chargesheet', note: 'Sample charge sheet filed' }, { on: '2999-01-01', kind: 'hearing' }],
  pendingStatus: 'trial',
};
const hit: PrecedentHit = {
  id: 'fx-1', title: 'Fictional State v. Sample Accused', citation: 'FICTIONAL/SC/2021/1', year: 2021,
  court: 'Supreme Court of India', snippet: 'Sample passage on default bail after the chargesheet period.', score: 0.9,
  url: 'https://example.test/fx-1', source: 'Fictional index', hint: true,
};

const mockApi = (over: Partial<CourtPlusApi> = {}): CourtPlusApi => ({
  listPersons: vi.fn(async () => []), listCases: vi.fn(async () => []), importOrder: vi.fn(),
  saveCase: vi.fn(), screen: vi.fn(async () => { throw new Error('no screening in this test'); }), board: vi.fn(async () => []),
  updateCard: vi.fn(), exportDraft: vi.fn(), exportScReturn: vi.fn(), verify: vi.fn(), stats: vi.fn(), role: vi.fn(async () => 'legal_aid'),
  ...over,
} as CourtPlusApi);

const wrap = (ui: JSX.Element, api = mockApi(), path = '/') =>
  render(<AppProvider api={api}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></AppProvider>);

function bridge(over: Partial<ResearchApi> = {}): ResearchApi {
  return {
    status: vi.fn(async () => ({ available: true, features: { search: true, sections: true, roles: true, fullText: false } })),
    searchPrecedents: vi.fn(async () => ({ available: true as const, items: [hit] })),
    openPrecedent: vi.fn(async () => null),
    suggestSections: vi.fn(async () => ({ available: true as const, items: [
      { act: 'IPC', section: '379', score: 0.8, bnsEquivalent: '303(2)', source: 'Fictional section model', hint: true as const },
    ] })),
    classifyRoles: vi.fn(async (sentences: string[]) => ({ available: true as const,
      items: sentences.map(sentence => ({ sentence, role: 'facts', score: 0.5, source: 'Fictional role model', hint: true as const })) })),
    logHint: vi.fn(async () => undefined),
    ...over,
  };
}

beforeEach(() => { localStorage.clear(); setRoleOverride(undefined); });
afterEach(() => { delete window.courtplusResearch; delete window.courtplusHearing; });

describe('research helpers', () => {
  it('highlights query words at word starts, ignoring case and stop words', () => {
    expect(queryTerms('Default bail under section 167')).toEqual(['default', 'bail', '167']);
    const parts = highlight('Bail was refused; default bail under s.167 applies.', 'default bail 167');
    expect(parts.filter(part => part.match).map(part => part.text)).toEqual(['Bail', 'default', 'bail', '167']);
    expect(highlight('no match here', 'bail')).toEqual([{ text: 'no match here', match: false }]);
  });

  it('formats a citation for copying', () => {
    expect(formatCitation(hit)).toBe('Fictional State v. Sample Accused, FICTIONAL/SC/2021/1, Supreme Court of India, 2021 (https://example.test/fx-1)');
  });

  it('builds hint text from confirmed case facts and splits sentences (English and Hindi)', () => {
    expect(caseHintText(fictionalCase)).toBe('Charges: IPC 379.\nCourt: Fictional Sessions Court.\nSample charge sheet filed.');
    expect(splitSentences('One sample. दूसरा वाक्य। Third?')).toEqual(['One sample.', 'दूसरा वाक्य।', 'Third?']);
  });
});

describe('Research screen', () => {
  async function search(words: string) {
    await userEvent.type(screen.getByLabelText('Search judgments'), words);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  }

  it('says research is desktop-only in the web build', async () => {
    wrap(<Research />);
    await search('bail');
    expect(await screen.findByText(/runs in the Court\+ desktop app/)).toBeInTheDocument();
  });

  it('shows "being installed" when the research package is missing', async () => {
    window.courtplusResearch = bridge({ searchPrecedents: vi.fn(async () => ({ available: false as const, reason: RESEARCH_INSTALLING })) });
    wrap(<Research />);
    await search('bail');
    expect(await screen.findByText(/Precedent search is being installed/)).toBeInTheDocument();
  });

  it('lists results with highlights, filters, copy and add to draft', async () => {
    const research = bridge();
    window.courtplusResearch = research;
    wrap(<Research />);
    await userEvent.selectOptions(screen.getByLabelText('Court'), 'Supreme Court');
    await userEvent.type(screen.getByLabelText('From year'), '2020');
    await search('default bail');
    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(research.searchPrecedents).toHaveBeenCalledWith({ query: 'default bail', k: 20, court: 'Supreme Court', yearFrom: 2020, yearTo: undefined });
    expect(within(results).getByText('FICTIONAL/SC/2021/1')).toBeInTheDocument();
    expect([...results.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['default', 'bail']);
    expect(within(results).getByText(new RegExp(HINT_LABEL))).toBeInTheDocument();

    await userEvent.click(within(results).getByRole('button', { name: 'Add to draft' }));
    expect(await screen.findByRole('region', { name: 'Citations for your draft' })).toHaveTextContent('FICTIONAL/SC/2021/1');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(within(results).getByRole('button', { name: 'Copy citation' }));
    expect(writeText).toHaveBeenCalledWith(formatCitation(hit));
    expect(await screen.findByText('Citation copied.')).toBeInTheDocument();
  });
});

describe('Hints for this case (judge)', () => {
  const api = () => mockApi({ listCases: vi.fn(async () => [fictionalCase]), listPersons: vi.fn(async () => []) });

  it('shows sourced hints with the judge-decides label and logs accept/dismiss', async () => {
    const research = bridge();
    window.courtplusResearch = research;
    wrap(<Routes><Route path="/case/:caseId" element={<CaseView />} /></Routes>, api(), '/case/fictional-c7');
    await userEvent.click(await screen.findByRole('button', { name: 'Show hints' }));
    const sections = await screen.findByRole('group', { name: 'Suggested sections' });
    expect(sections).toHaveTextContent('IPC 379');
    expect(sections).toHaveTextContent('BNS equivalent: 303(2)');
    expect(sections).toHaveTextContent(`Source: Fictional section model · ${HINT_LABEL}`);
    expect(screen.getByRole('group', { name: 'Similar past cases' })).toHaveTextContent('Fictional State v. Sample Accused');
    expect(screen.getByRole('group', { name: 'Case structure' })).toHaveTextContent('Facts');
    expect(document.body.textContent).not.toMatch(/probability|likely to (win|succeed)|verdict will/i);

    await userEvent.click(within(sections).getByRole('button', { name: 'Accept IPC 379' }));
    await waitFor(() => expect(research.logHint).toHaveBeenCalledWith({
      caseId: 'fictional-c7', kind: 'section', hintId: 'section:IPC 379', label: 'IPC 379', source: 'Fictional section model', decision: 'accepted',
    }));
    expect(within(sections).getByText(/Accepted \(logged\)/)).toBeInTheDocument();
  });

  it('says "being installed" per group and is hidden for the citizen view', async () => {
    const missing = { available: false as const, reason: RESEARCH_INSTALLING };
    window.courtplusResearch = bridge({ suggestSections: vi.fn(async () => missing), searchPrecedents: vi.fn(async () => missing), classifyRoles: vi.fn(async () => missing) });
    const view = wrap(<Routes><Route path="/case/:caseId" element={<CaseView />} /></Routes>, api(), '/case/fictional-c7');
    await userEvent.click(await screen.findByRole('button', { name: 'Show hints' }));
    expect(await screen.findAllByText(/Precedent search is being installed/)).toHaveLength(3);
    view.unmount();

    setRoleOverride('citizen');
    wrap(<Routes><Route path="/case/:caseId" element={<CaseView />} /></Routes>, api(), '/case/fictional-c7');
    await screen.findByText(/What if we look/);
    expect(screen.queryByText('Hints for this case')).not.toBeInTheDocument();
  });
});

describe('Rights advisor', () => {
  it('matches plain words to a guide', () => {
    expect(adviseFor('my employer has not paid my salary for three months')[0]?.guide.id).toBe('unpaid-wages');
    expect(adviseFor('चेक बाउंस हो गया')[0]?.guide.id).toBe('cheque-bounce');
  });

  it('shows the top guide as a card with rights, steps, aid and other matches as chips', async () => {
    wrap(<RightsAdvisor />);
    await userEvent.type(screen.getByLabelText('Describe your problem in your own words'), 'my cheque bounced and the bank gave a return memo');
    await userEvent.click(screen.getByRole('button', { name: 'Find my rights and next steps' }));
    const card = await screen.findByRole('article');
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(/Cheque Bounce/);
    expect(within(card).getByText('Your rights')).toBeInTheDocument();
    expect(within(card).getByText(/Negotiable Instruments Act, 1881, Section 138/)).toBeInTheDocument();
    expect(within(card).getAllByRole('link', { name: 'Official text' })[0]).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
    expect(within(card).getByText('What to do, step by step')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Talk to free legal aid (NALSA 15100)' })[0]).toHaveAttribute('href', 'tel:15100');
    expect(screen.queryByRole('textbox', { name: /reply|message/i })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/Show guide in/), 'hi');
    expect(within(screen.getByRole('article')).getAllByText(/Hindi not yet reviewed/).length).toBeGreaterThan(0);
  });

  it('offers topics and free legal aid when nothing matches', async () => {
    wrap(<RightsAdvisor />);
    await userEvent.type(screen.getByLabelText('Describe your problem in your own words'), 'zzzz qqqq');
    await userEvent.click(screen.getByRole('button', { name: 'Find my rights and next steps' }));
    expect(await screen.findByText(/could not match your words/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Topics' })).toBeInTheDocument();
  });
});

describe('Track my case', () => {
  it('finds a case however the number is typed', () => {
    expect(findCase([fictionalCase], ' fictional-7-2026 ')?.id).toBe('fictional-c7');
    expect(findCase([fictionalCase], 'FICTIONAL 8/2026')).toBeUndefined();
    const sameNumber = { ...fictionalCase, id: 'fictional-c8', cnr: 'FX001' };
    expect(findCase([fictionalCase, sameNumber], 'FICTIONAL 7/2026')).toBeUndefined();
    expect(findCase([fictionalCase, sameNumber], 'FX-001')).toBe(sameNumber);
  });

  it('shows stage, next date, history and the eCourts link', async () => {
    wrap(<TrackCase />, mockApi({ listCases: vi.fn(async () => [fictionalCase]) }));
    expect(screen.getByRole('link', { name: 'Official case status on eCourts services' })).toHaveAttribute('href', ECOURTS_CASE_STATUS);
    await userEvent.type(screen.getByLabelText('Case number or CNR'), 'fictional 7/2026');
    await userEvent.click(screen.getByRole('button', { name: 'Find my case' }));
    const status = await screen.findByRole('region', { name: 'Case status' });
    expect(status).toHaveTextContent('trial — The court is hearing evidence');
    expect(status).toHaveTextContent('Next date: 2999-01-01 (Hearing)');
    expect(status).toHaveTextContent('Charge sheet: the police filed their final report in court — Sample charge sheet filed');
    expect(await within(status).findByText(/No signed hearing transcript/)).toBeInTheDocument();
  });

  it('says when the office has no such case', async () => {
    wrap(<TrackCase />);
    await userEvent.type(screen.getByLabelText('Case number or CNR'), 'FICTIONAL-404');
    await userEvent.click(screen.getByRole('button', { name: 'Find my case' }));
    expect(await screen.findByText(/could not find a unique case with that number/)).toBeInTheDocument();
  });

  it('shows the recorded postponement without presenting it as a future hearing', async () => {
    const postponed = {
      ...fictionalCase,
      events: [
        { on: '2026-01-05', kind: 'adjournment' as const, note: 'The office recorded a postponement.',
          adjournment: { requestedBy: 'court' as const, reason: 'bench_unavailable' as const, daysGranted: 14 } },
        { on: '2999-01-01', kind: 'adjournment' as const },
      ],
    };
    wrap(<TrackCase />, mockApi({ listCases: vi.fn(async () => [postponed]) }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Case number or CNR'), 'FICTIONAL 7/2026');
    await user.click(screen.getByRole('button', { name: 'Find my case' }));
    const status = await screen.findByRole('region', { name: 'Case status' });
    expect(status).toHaveTextContent('Recorded postponement');
    expect(status).toHaveTextContent('Time granted (days) 14');
    expect(status).toHaveTextContent('No next date recorded here yet');
    expect(status).not.toHaveTextContent('2999-01-01');
  });

  it('groups material from the latest signed transcript of the selected case and keeps other cases out', async () => {
    const selected = { id: 'hearing-1', caseId: fictionalCase.id, startedAt: '2026-01-06T19:00:00Z', state: 'recorded' as const, transcriptVersions: 3 };
    const signed = {
      recordingId: selected.id, version: 2, receipt: 'signed fixture receipt', kind: 'edited' as const,
      audioSha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), segments: [], edits: [], createdAt: selected.startedAt,
    };
    const transcripts = vi.fn(async (id: string) => {
      if (id === 'unavailable') throw new Error('Fictional unavailable transcript');
      return [{ ...signed, version: 3, receipt: undefined }, signed, { ...signed, version: 1 }];
    });
    const summary = vi.fn<HearingApi['summary']>(async () => ({
      label: 'Machine summary - verify before use', method: 'Fictional extractive source', basedOnVersion: 2,
      sentences: [
        { text: 'A witness described the exhibit.', segmentId: 1, startMs: 8000, keywords: ['witness', 'evidence'], score: 1 },
        { text: 'The matter was listed on a later date.', segmentId: 1, startMs: 8000, keywords: ['next date'], score: 1 },
      ],
    }));
    window.courtplusHearing = {
      list: vi.fn(async () => [selected, { ...selected, id: 'unavailable' }, { ...selected, id: 'another-case', caseId: 'unrelated' }]),
      transcripts, summary,
    } as unknown as HearingApi;
    const record = { ...fictionalCase, events: [...fictionalCase.events,
      { on: '2026-01-07', kind: 'hearing' as const, source: { docId: 'fictional-order', page: 2 } }] };
    wrap(<TrackCase />, mockApi({ listCases: vi.fn(async () => [record]) }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Case number or CNR'), 'FICTIONAL 7/2026');
    await user.click(screen.getByRole('button', { name: 'Find my case' }));
    const section = await screen.findByRole('region', { name: 'Hearing breakdowns' });
    expect(await within(section).findByText(/Signed transcript version 2/)).toHaveTextContent('7 January 2026');
    expect(section).toHaveTextContent('Dates or postponements mentioned');
    expect(section).toHaveTextContent('Evidence or witnesses mentioned');
    expect(section).toHaveTextContent('00:08');
    expect(section).toHaveTextContent('Some hearing breakdowns could not be loaded');
    expect(screen.getByRole('region', { name: 'Case status' })).toHaveTextContent('Source document page 2');
    expect(summary).toHaveBeenCalledExactlyOnceWith(selected.id, 2);
    expect(transcripts).not.toHaveBeenCalledWith('another-case');
  });

  it('calculates net receipts or out-of-pocket costs without submitting settlement inputs to the API', async () => {
    const listCases = vi.fn(async () => [fictionalCase]);
    wrap(<TrackCase />, mockApi({ listCases }));
    const user = userEvent.setup();
    const estimator = within(screen.getByRole('region', { name: 'Settlement estimator' }));
    await user.type(estimator.getByLabelText('Upfront amount (₹)'), '1000.25');
    await user.type(estimator.getByLabelText('Amount per instalment (₹)'), '500.10');
    await user.click(estimator.getByRole('button', { name: 'Calculate estimate' }));
    expect(estimator.getByRole('alert')).toHaveTextContent('Enter both the amount per instalment');
    await user.type(estimator.getByLabelText('Number of instalments'), '3');
    await user.type(estimator.getByLabelText('Your estimated fees and costs (₹)'), '100.05');
    await user.type(estimator.getByLabelText('Your comparison amount after costs (₹, optional)'), '2500');
    await user.click(estimator.getByRole('button', { name: 'Calculate estimate' }));
    expect(estimator.getByLabelText('Settlement estimate')).toHaveTextContent('You would receive after costs₹2,400.50');
    expect(estimator.getByLabelText('Settlement estimate')).toHaveTextContent('₹99.50 below');
    await user.selectOptions(estimator.getByLabelText('Under the proposal, I would'), 'pay');
    expect(estimator.queryByLabelText('Settlement estimate')).not.toBeInTheDocument();
    await user.click(estimator.getByRole('button', { name: 'Calculate estimate' }));
    expect(estimator.getByLabelText('Settlement estimate')).toHaveTextContent('You would pay including costs₹2,600.60');
    await user.click(estimator.getByRole('button', { name: 'Clear amounts' }));
    expect(estimator.queryByLabelText('Settlement estimate')).not.toBeInTheDocument();
    expect(estimator.getByLabelText('Upfront amount (₹)')).toHaveValue(null);
    expect(listCases).not.toHaveBeenCalled();
  });
});

describe('Roles and navigation', () => {
  it('groups profile roles into Judge, Lawyer and Citizen', () => {
    expect(roleGroup('utrc_member')).toBe('judge');
    expect(roleGroup('jail_superintendent')).toBe('judge');
    expect(roleGroup('dlsa')).toBe('lawyer');
    expect(roleGroup('legal_aid_lawyer')).toBe('lawyer');
    expect(roleGroup('citizen')).toBe('citizen');
  });

  const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));
  const primary = () => [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll(':scope > ul > li a')].map(link => link.textContent);

  it('judge: role dashboard, research and India backlog', async () => {
    wrap(<App />);
    expect(primary()).toEqual(['Judge dashboard', 'Evidence inbox', 'Hearing recorder', 'Research', 'Drafts', 'Cases']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Judge dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "India's backlog" })).toBeInTheDocument();
    expect(nav().getByText('More tools')).toBeInTheDocument();
  });

  it('lawyer: workspace with research and file evidence; no backlog card', async () => {
    setRoleOverride('lawyer');
    wrap(<App />);
    expect(primary()).toEqual(['Lawyer workspace', 'Cases', 'Case analyzer', 'Settlement', 'Research', 'File evidence', 'Drafts']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Lawyer workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: "India's backlog" })).not.toBeInTheDocument();
  });

  it('citizen: only the citizen tools, and home is Citizen help', async () => {
    setRoleOverride('citizen');
    wrap(<App />);
    expect(primary()).toEqual(['Rights advisor', 'Submit proof', 'Track my case', 'Safeguards']);
    expect(nav().queryByText('More tools')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Citizen help' })).toBeInTheDocument();
    expect(screen.getByText('Court+')).toBeInTheDocument();
  });

  it('backlog figures come straight from india.json with source and date', () => {
    const figures = backlogFigures();
    expect(figures.map(figure => figure.id)).toEqual(['hc-pending-india', 'hc-pending-cg', 'district-10y-india', 'hc-judge-vacancy-india', 'national-lok-adalat-2025']);
    for (const figure of figures) {
      const original = india.figures.find(item => item.id === figure.id)!;
      expect([figure.value, figure.url, figure.date]).toEqual([original.value, original.url, original.date]);
      expect(figure.url).toMatch(/^https:\/\/www\.data\.gov\.in\//);
    }
  });
});
