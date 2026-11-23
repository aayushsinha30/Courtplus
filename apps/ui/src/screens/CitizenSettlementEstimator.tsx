import { useId, useState, type FormEvent } from 'react';
import { btn, btnPrimary, ErrorNote } from '../components/ui';
import { t } from '../lib/i18n';

const maxRupees = 1_000_000_000;
const maxPayments = 1200;
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const format = (paise: number) => currency.format(paise / 100);

function amountInPaise(value: string): number {
  if (!value) return 0;
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value) || Number(value) > maxRupees) {
    throw new Error(t('track.settlement.invalidAmount', 'Enter non-negative amounts in rupees, with up to two decimal places.'));
  }
  const [rupees, paise = ''] = value.split('.');
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
}

type Estimate = {
  receiving: boolean;
  upfront: number;
  instalment: number;
  count: number;
  fees: number;
  gross: number;
  net: number;
  comparison?: number;
};

function calculate(form: FormData): Estimate {
  const read = (name: string) => String(form.get(name) ?? '').trim();
  const receiving = read('direction') === 'receive';
  const upfrontInput = read('upfront');
  const instalmentInput = read('instalment');
  const countInput = read('count');
  const comparisonInput = read('comparison');
  if (!upfrontInput && !instalmentInput && !countInput) {
    throw new Error(t('track.settlement.noTerms', 'Enter an upfront amount or an instalment plan.'));
  }
  if (Boolean(instalmentInput) !== Boolean(countInput) ||
    (countInput && (!/^\d+$/.test(countInput) || Number(countInput) < 1 || Number(countInput) > maxPayments))) {
    throw new Error(t('track.settlement.invalidPlan', 'Enter both the amount per instalment and a whole number of instalments from 1 to 1,200.'));
  }
  const upfront = amountInPaise(upfrontInput);
  const instalment = amountInPaise(instalmentInput);
  const count = Number(countInput);
  const fees = amountInPaise(read('fees'));
  const gross = upfront + instalment * count;
  return {
    receiving, upfront, instalment, count, fees, gross, net: receiving ? gross - fees : gross + fees,
    comparison: comparisonInput ? amountInPaise(comparisonInput) : undefined,
  };
}

export function CitizenSettlementEstimator() {
  const headingId = useId();
  const [estimate, setEstimate] = useState<Estimate>();
  const [error, setError] = useState<string | null>(null);
  function clearResult() {
    setEstimate(undefined);
    setError(null);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setEstimate(calculate(new FormData(event.currentTarget)));
      setError(null);
    } catch (cause) {
      setEstimate(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const fields = [
    { name: 'upfront', label: t('track.settlement.upfront', 'Upfront amount (₹)') },
    { name: 'instalment', label: t('track.settlement.instalment', 'Amount per instalment (₹)') },
    { name: 'count', label: t('track.settlement.count', 'Number of instalments'), count: true },
    { name: 'fees', label: t('track.settlement.fees', 'Your estimated fees and costs (₹)') },
    { name: 'comparison', label: t('track.settlement.comparison', 'Your comparison amount after costs (₹, optional)') },
  ];
  const difference = estimate?.comparison === undefined ? undefined : estimate.net - estimate.comparison;
  return <section className="panel mt-4 grid gap-3" aria-labelledby={headingId}>
    <div>
      <h2 className="text-lg font-semibold" id={headingId}>{t('track.settlement.title', 'Settlement estimator')}</h2>
      <p>{t('track.settlement.intro', 'Compare proposed payment terms after costs. The estimate uses only the amounts you enter. Your entries stay on this screen.')}</p>
    </div>
    <form onSubmit={submit} onChange={clearResult} onReset={clearResult} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>{t('track.settlement.direction', 'Under the proposal, I would')}
          <select className="field-control" name="direction">
            <option value="receive">{t('track.settlement.receive', 'Receive money')}</option>
            <option value="pay">{t('track.settlement.pay', 'Pay money')}</option>
          </select>
        </label>
        {fields.map(({ name, label, count }) => <label key={name}>{label}
          <input className="field-control" name={name} type="number" min={count ? 1 : 0}
            max={count ? maxPayments : maxRupees} step={count ? '1' : '0.01'} />
        </label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary}>{t('track.settlement.calculate', 'Calculate estimate')}</button>
        <button className={btn} type="reset">{t('track.settlement.clear', 'Clear amounts')}</button>
      </div>
    </form>
    <ErrorNote error={error} />
    <div aria-live="polite">
      {estimate && <dl className="grid gap-2 rounded border p-3 sm:grid-cols-2" aria-label={t('track.settlement.result', 'Settlement estimate')}>
        <div><dt>{t('track.settlement.total', 'Total proposed payment')}</dt>
          <dd className="font-semibold">{format(estimate.gross)}</dd></div>
        <div><dt>{estimate.receiving ? t('track.settlement.netReceive', 'You would receive after costs') : t('track.settlement.netPay', 'You would pay including costs')}</dt>
          <dd className="font-semibold">{format(estimate.net)}</dd></div>
        <div><dt>{t('track.settlement.working', 'How it adds up')}</dt>
          <dd>{format(estimate.upfront)} + {estimate.count} × {format(estimate.instalment)} {estimate.receiving ? '−' : '+'} {format(estimate.fees)} = {format(estimate.net)}</dd></div>
        {difference !== undefined && <div><dt>{t('track.settlement.difference', 'Compared with your amount')}</dt>
          <dd>{difference === 0 ? t('track.settlement.same', 'Same amount')
            : format(Math.abs(difference)) + ' ' + (difference > 0 ? t('track.settlement.above', 'above') : t('track.settlement.below', 'below'))}</dd></div>}
      </dl>}
    </div>
  </section>;
}
