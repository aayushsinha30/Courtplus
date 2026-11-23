import { useApp } from '../lib/context';
import { ui } from '../lib/i18n';
import { UI_LANGUAGES } from '../lib/preferences';
import { Icon } from './icons';

export function DisplayControls() {
  const { language, setLanguage, theme, toggleTheme } = useApp();
  return <div className="display-controls" role="group" aria-label={ui('Display preferences')}>
    <label className="view-control interface-language">
      <span className="sr-only">{ui('App language')}</span>
      <select value={language} onChange={event => setLanguage(event.target.value)}>
        {UI_LANGUAGES.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
      </select>
    </label>
    <button type="button" className="icon-button theme-toggle" title={ui(theme === 'night' ? 'Switch to day mode' : 'Switch to night mode')}
      aria-label={ui('Night mode')} aria-pressed={theme === 'night'} onClick={toggleTheme}>
      <Icon name={theme === 'night' ? 'sun' : 'moon'} />
    </button>
  </div>;
}
