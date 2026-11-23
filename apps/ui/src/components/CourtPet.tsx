import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ui } from '../lib/i18n';
import type { RoleGroup } from '../lib/roles';
import './court-pet.css';

type Guide = { to: string; name: string; answer: string; phrases: readonly string[] };

const guides = {
  track: { to: '/track', name: 'Track my case', answer: 'Enter your case number or CNR to see recorded dates and hearing details.',
    phrases: ['track', 'case status', 'case number', 'cnr', 'next hearing', 'मामले की स्थिति', 'मामला संख्या', 'सीएनआर', 'अगली सुनवाई'] },
  rights: { to: '/rights', name: 'Rights advisor', answer: 'The Rights advisor helps you find a guide on your rights and where to get legal aid.',
    phrases: ['rights', 'legal aid', 'guide', 'अधिकार', 'विधिक सहायता', 'कानूनी मदद'] },
  proof: { to: '/submit-proof', name: 'Submit proof', answer: 'Open Submit proof to see what you can send and how to keep the receipt.',
    phrases: ['proof', 'upload evidence', 'submit evidence', 'anonymous', 'whistleblower', 'सबूत', 'साक्ष्य भेजें', 'गुमनाम'] },
  settlement: { to: '/settlement-guide', name: 'Settlement guide', answer: 'Use the settlement guide to compare proposed payments and costs.',
    phrases: ['settlement', 'estimator', 'installment', 'instalment', 'समझौता', 'किस्त'] },
  evidence: { to: '/evidence', name: 'Evidence inbox', answer: 'The evidence inbox contains submissions available to your court workspace.',
    phrases: ['evidence', 'inbox', 'submissions', 'साक्ष्य', 'इनबॉक्स'] },
  hearing: { to: '/hearings', name: 'Hearing recorder', answer: 'Use the hearing recorder on the court desktop to record or open a hearing.',
    phrases: ['record hearing', 'recording', 'transcript', 'रिकॉर्डिंग', 'प्रतिलेख'] },
  drafts: { to: '/drafts', name: 'Drafts', answer: 'Open Drafts to pick a template and review it before exporting.',
    phrases: ['draft', 'drafts', 'template', 'मसौदा', 'मसौदे', 'प्रारूप'] },
  research: { to: '/research', name: 'Research', answer: 'Research lets you look for published judgments and see the source of each result.',
    phrases: ['research', 'judgment', 'judgments', 'precedent', 'शोध', 'नज़ीर', 'निर्णय खोजें'] },
  cases: { to: '/cases', name: 'Cases', answer: 'The case list shows the records available to your workspace.',
    phrases: ['case list', 'cases', 'मामले', 'मामलों की सूची'] },
  verify: { to: '/verify', name: 'Verifier', answer: 'Use the verifier to check a signed Court+ PDF and its receipt.',
    phrases: ['verify', 'signature', 'signed pdf', 'सत्यापन', 'हस्ताक्षर'] },
} satisfies Record<string, Guide>;

type GuideId = keyof typeof guides;
const byRole: Record<RoleGroup, readonly GuideId[]> = {
  citizen: ['track', 'proof', 'rights', 'settlement', 'verify'],
  judge: ['evidence', 'hearing', 'drafts', 'research', 'cases', 'verify'],
  lawyer: ['research', 'drafts', 'cases', 'verify'],
};

function normalize(value: string) {
  return ' ' + value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' ';
}

function matchGuide(question: string, topics: readonly GuideId[]) {
  const text = normalize(question);
  let best: GuideId | undefined;
  let score = 0;
  for (const id of topics) {
    for (const phrase of guides[id].phrases) {
      const cue = normalize(phrase);
      if (cue.length > score && text.includes(cue)) {
        score = cue.length;
        best = id;
      }
    }
  }
  return best;
}

function Owl() {
  return <span className="court-pet-owl" aria-hidden="true">
    <span className="court-pet-tuft court-pet-tuft-left" />
    <span className="court-pet-tuft court-pet-tuft-right" />
    <span className="court-pet-body">
      <span className="court-pet-feathers" />
      <span className="court-pet-eye court-pet-eye-left" />
      <span className="court-pet-eye court-pet-eye-right" />
      <span className="court-pet-beak" />
      <span className="court-pet-cheek court-pet-cheek-left" />
      <span className="court-pet-cheek court-pet-cheek-right" />
    </span>
  </span>;
}

export function CourtPet({ role, canRecord }: { role: RoleGroup; canRecord: boolean }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<GuideId | 'unknown'>();
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const topics = byRole[role].filter(id => id !== 'hearing' || canRecord);
  const selected = response && response !== 'unknown' && topics.includes(response) ? guides[response] : undefined;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close(restoreFocus: boolean) {
    setOpen(false);
    setResponse(undefined);
    setQuestion('');
    if (restoreFocus) launcher.current?.focus();
  }

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setResponse(matchGuide(question, topics) ?? 'unknown');
    setQuestion('');
    input.current?.focus();
  }

  function onEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
    }
  }

  return <div className="court-pet">
    {open && <section className="court-pet-panel" role="dialog" aria-labelledby={titleId} id={dialogId} onKeyDown={onEscape}>
      <header className="court-pet-header">
        <div>
          <h2 id={titleId}>{ui('Tuki, your Court+ companion')}</h2>
          <p>{ui('Ask me where to go in Court+.')}</p>
        </div>
        <button className="court-pet-close" type="button" onClick={() => close(true)} aria-label={ui('Close companion')}>×</button>
      </header>
      <div className="court-pet-content">
        <div className="court-pet-reply" aria-live="polite">
          {selected ? <>
            <p>{ui(selected.answer)}</p>
            <Link className="court-pet-link" to={selected.to} onClick={() => close(false)}>{ui(selected.name)} <span aria-hidden="true">↗</span></Link>
          </> : <p>{ui(response ? 'I could not match that to an app tool. Try one of these tasks.' : 'What would you like to do?')}</p>}
        </div>
        <div className="court-pet-topics" role="group" aria-label={ui('Suggested tasks')}>
          {topics.slice(0, 4).map(id => <button key={id} type="button" aria-pressed={response === id} onClick={() => setResponse(id)}>
            {ui(guides[id].name)}
          </button>)}
        </div>
        <form onSubmit={ask} className="court-pet-form">
          <label className="sr-only" htmlFor={dialogId + '-question'}>{ui('Ask Tuki')}</label>
          <input ref={input} id={dialogId + '-question'} maxLength={160} autoComplete="off"
            value={question} onChange={event => setQuestion(event.target.value)} placeholder={ui('Find a Court+ tool…')} />
          <button type="submit" disabled={!question.trim()}>{ui('Ask')}</button>
        </form>
        <p className="court-pet-note">{ui('Offline app guide. Keep case details out of your question.')}</p>
      </div>
    </section>}
    <button ref={launcher} className="court-pet-launcher" type="button" aria-expanded={open}
      aria-controls={open ? dialogId : undefined} aria-label={ui('Ask Tuki')}
      onClick={() => open ? close(false) : setOpen(true)}>
      <Owl /><span className="court-pet-name">Tuki</span>
    </button>
  </div>;
}
