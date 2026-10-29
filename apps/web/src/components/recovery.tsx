'use client';
import { useState } from 'react';
import { authRequest } from '../lib/session';
import { Modal } from './ui';

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  function download() {
    const url = URL.createObjectURL(new Blob(['Veriqon password recovery codes\nKeep these private. Each code can be used once.\n\n' + codes.join('\n')], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = 'veriqon-recovery-codes.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="recovery-section"><p>Save these codes in your password manager. They will not be shown again. Anyone with a code and your email can reset your password.</p><ul className="recovery-codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><button className="button secondary" onClick={download}>Download recovery codes</button><label className="recovery-confirm"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my recovery codes somewhere safe</label><button className="button primary" disabled={!saved} onClick={onDone}>Done</button></section>;
}

export function RecoveryCodesDialog({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return <Modal open={codes.length > 0} onClose={() => { /* Require explicit acknowledgement before dismissing the only copy. */ }} title="Save your recovery codes" description="Your backup way to recover this account without email."><RecoveryCodes codes={codes} onDone={onDone} /></Modal>;
}

export function RecoverySettings() {
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; const form = e.currentTarget;
    setBusy(true); setError('');
    try { const result = await authRequest<{ codes: string[] }>('recovery-codes', { password: String(new FormData(form).get('password')) }); form.reset(); setCodes(result.codes); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not generate codes.'); }
    finally { setBusy(false); }
  }
  return <section className="recovery-section"><h3>Password recovery</h3><p className="muted">Generate eight one-time backup codes. This replaces all previous codes. Store them before you need to recover your account.</p>{codes.length ? <RecoveryCodes codes={codes} onDone={() => setCodes([])} /> : <form onSubmit={e => void generate(e)}><label className="auth-field">Confirm current password<input name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></label>{error && <p role="alert" className="auth-error">{error}</p>}<button className="button secondary" disabled={busy}>{busy ? 'Generating…' : 'Generate recovery codes'}</button></form>}</section>;
}

export function RecoverPassword({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const form = e.currentTarget, values = new FormData(form);
    if (values.get('password') !== values.get('confirmation')) { setError('The new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await authRequest('recover', { email: String(values.get('email')), code: String(values.get('code')), password: String(values.get('password')) });
      form.reset(); setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Recovery failed. Please retry.'); }
    finally { setBusy(false); }
  }
  return <>{done ? <p role="status">Password changed. Your previous sessions have been signed out. Sign in with your new password.</p> : <form onSubmit={e => void submit(e)}><p className="muted">Use one of the recovery codes you saved. If you never saved any, contact the workspace operator; your email alone cannot prove ownership.</p><label className="auth-field">Recovery email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label><label className="auth-field">Recovery code<input name="code" autoComplete="off" spellCheck={false} required minLength={32} maxLength={80} disabled={busy} /></label><label className="auth-field">New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} /></label><label className="auth-field">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} /></label>{error && <p role="alert" className="auth-error">{error}</p>}<button className="button primary auth-submit" disabled={busy}>{busy ? 'Resetting password…' : 'Reset password'}</button></form>}<p className="auth-switch"><button disabled={busy} onClick={onBack}>Back to sign in</button></p></>;
}
