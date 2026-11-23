import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CourtPet } from '../components/CourtPet';
import { loadLang } from '../lib/i18n';

afterEach(() => loadLang('en'));

describe('Tuki', () => {
  it('answers a Hindi navigation question and opens the existing tracking route', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter>
      <CourtPet role="citizen" canRecord={false} />
      <Routes><Route path="/track" element={<h1>Tracking destination</h1>} /></Routes>
    </MemoryRouter>);
    const launcher = screen.getByRole('button', { name: 'Ask Tuki' });
    await user.click(launcher);
    const dialog = within(screen.getByRole('dialog'));
    const question = dialog.getByRole('textbox', { name: 'Ask Tuki' });
    expect(question).toHaveFocus();
    await user.type(question, 'मेरी अगली सुनवाई कब है?{Enter}');
    expect(dialog.getByText(/Enter your case number or CNR/)).toBeInTheDocument();
    expect(question).toHaveValue('');
    await user.click(dialog.getByRole('link', { name: 'Track my case' }));
    expect(screen.getByRole('heading', { name: 'Tracking destination' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('localizes its controls, omits the desktop recorder on web, and restores focus on Escape', async () => {
    await loadLang('hi');
    const user = userEvent.setup();
    render(<MemoryRouter><CourtPet role="judge" canRecord={false} /></MemoryRouter>);
    const launcher = screen.getByRole('button', { name: 'टुकी से पूछें' });
    await user.click(launcher);
    const dialog = within(screen.getByRole('dialog', { name: 'टुकी, आपका Court+ साथी' }));
    expect(dialog.queryByRole('button', { name: 'सुनवाई रिकॉर्डर' })).not.toBeInTheDocument();
    await user.type(dialog.getByRole('textbox'), 'record hearing{Enter}');
    expect(dialog.getByText(/इसके लिए कोई ऐप उपकरण नहीं मिला/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(launcher).toHaveFocus();
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
  });
});
