'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Check, Eye, EyeOff, Fingerprint, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { authRequest, type Account } from '../lib/session';
import { BrandMark } from './ui';
import { ThemeToggle } from './theme-provider';
import { Workspace } from './workspace';

export function AuthGate() {
  const [user, setUser] = useState<Account | null>(null);
  const [status, setStatus] = useState<{ needsSetup: boolean; registrationEnabled: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const configuration = await authRequest<{ needsSetup: boolean; registrationEnabled: boolean }>('status');
      setStatus(configuration); if (configuration.needsSetup) { setMode('register'); setUser(null); return; }
      try { const session = await authRequest<{ user: Account }>('me'); setUser(session.user); } catch { setUser(null); setError(''); }
    } catch { setError('Could not reach your workspace. Please try again in a moment.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    setWaking(false);
    if (!loading) return;
    const timer = setTimeout(() => setWaking(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    void load();
    const expired = () => { setUser(null); setError('Your session has expired. Sign in to continue.'); };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('veriqon-session') : null;
    if (channel) channel.onmessage = () => { void load(); };
    window.addEventListener('veriqon:session-expired', expired);
    return () => { channel?.close(); window.removeEventListener('veriqon:session-expired', expired); };
  }, [load]);
  function notifyTabs() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('veriqon-session'); channel.postMessage('changed'); channel.close(); } }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const body = { email: String(values.get('email')), password: String(values.get('password')), ...(mode === 'register' ? { name: String(values.get('name')), ...(status?.needsSetup ? { setupCode: String(values.get('setupCode')) } : {}) } : {}) };
      const result = await authRequest<{ user: Account }>(mode, body);
      setUser(result.user); setStatus(current => current && { ...current, needsSetup: false }); notifyTabs();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    await authRequest('logout', {}); setUser(null); setMode('login'); setError(''); notifyTabs();
  }
  if (loading) return <div className="auth-loading"><BrandMark /><LoaderCircle size={18} className="spin" /><span role="status">{waking ? 'Waking up your workspace. This can take about a minute.' : 'Opening your workspace'}</span></div>;
  if (user) return <Workspace key={user.id} account={user} onLogout={logout} />;
  const registering = mode === 'register';
  return <div className="auth-page">
    <section className="auth-story" aria-label="About Veriqon">
      <a className="auth-brand" href="/"><BrandMark /><span>Veriqon<span className="brand-period">.</span></span></a>
      <div className="auth-story-content"><span className="auth-eyebrow"><span className="tiny-dot" /> A PRIVATE SPACE FOR YOUR KNOWLEDGE</span><h1>Better answers.<br /><span>Built on your sources.</span></h1><p>Bring your documents together. Ask a question.<br />Follow every answer back to the evidence.</p>
        <div className="auth-preview"><div className="preview-top"><span><BookOpen size={14} /> Research workspace</span><span className="preview-pill"><span /> Private</span></div><div className="preview-question">What connects the ideas in my research?</div><div className="preview-answer"><span className="preview-spark"><Sparkles size={19} /></span><div><span className="preview-line long" /><span className="preview-line" /><span className="preview-line short" /><div className="preview-sources"><span>01 Source</span><span>02 Source</span><span><Check size={11} /> Evidence checked</span></div></div></div></div>
      </div><div className="auth-story-footer"><span><ShieldCheck size={15} /> Your documents. Your workspace.</span><span>VERIQON / 01</span></div>
    </section>
    <section className="auth-form-panel"><div className="auth-top"><a className="auth-mobile-brand" href="/"><BrandMark small /> Veriqon</a><ThemeToggle /></div><div className="auth-form-wrap"><div className="auth-symbol"><Fingerprint size={26} strokeWidth={1.4} /></div><span className="eyebrow">{status?.needsSetup ? 'YOUR WORKSPACE STARTS HERE' : registering ? 'A LITTLE MORE CLARITY' : 'YOUR KNOWLEDGE, CONNECTED'}</span><h2>{status?.needsSetup ? 'Make it yours.' : registering ? 'Create your account.' : 'Welcome back.'}</h2><p className="auth-description">{status?.needsSetup ? 'Create the owner account to secure your workspace and keep your existing documents.' : registering ? 'A private library and an assistant grounded in your work.' : 'Sign in to pick up where your research left off.'}</p>
      {!status ? <><p role="alert" className="auth-error">{error}</p><button className="button primary auth-submit" onClick={() => void load()}>Retry connection</button></> : <form onSubmit={event => void submit(event)}>
        {registering && <label className="auth-field">Full name<input name="name" autoComplete="name" required maxLength={80} placeholder="Your name" disabled={busy} /></label>}
        <label className="auth-field">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" disabled={busy} /></label>
        <label className="auth-field">Password<div className="auth-password"><input name="password" type={visible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 12 : 1} maxLength={128} placeholder={registering ? 'At least 12 characters' : 'Enter your password'} disabled={busy} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {status.needsSetup && <label className="auth-field">One-time setup code<input name="setupCode" autoComplete="off" required maxLength={128} placeholder="Enter your setup code" disabled={busy} /><small>Find your code in <code>data/setup-code.txt</code> on this computer. It protects ownership of your existing library.</small></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" disabled={busy} type="submit">{busy ? <><LoaderCircle size={17} className="spin" /> {registering ? 'Creating your workspace' : 'Signing you in'}</> : <>{registering ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></>}</button>
      </form>}
      {status && !status.needsSetup && (status.registrationEnabled || registering) && <p className="auth-switch">{registering ? 'Already have an account?' : 'New to Veriqon?'} <button disabled={busy} onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}>{registering ? 'Sign in' : 'Create an account'}</button></p>}
      <div className="auth-trust"><LockKeyhole size={14} /><span>Private documents. Secure sign-in.</span></div>
    </div><footer className="auth-footer">A clearer view of what you know.</footer></section>
  </div>;
}
