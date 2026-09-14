import { FormEvent, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import StatusMessage from '../components/StatusMessage';

export default function AuthPage() {
  const { resetPassword, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'reset') {
        await resetPassword(email.trim());
        setMessage('Password reset email sent. Open its link to choose a new password.');
      } else if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const signedIn = await signUp(email.trim(), password, displayName.trim());
        if (!signedIn) setMessage('Account created. Check your email to confirm the account, then sign in.');
      }
    } catch (submissionError: any) {
      const errorMessage = submissionError?.message || 'Authentication failed';
      const networkFailure = submissionError?.name === 'AuthRetryableFetchError'
        || /failed to fetch|fetch failed|networkerror|load failed/i.test(errorMessage);
      setError(networkFailure
        ? 'Cannot reach the sign-in service. Check your internet connection and try again. If this continues, ask the workspace administrator to check that the Supabase project is running and its URL is correct.'
        : errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="surface-card w-full max-w-md p-8 sm:p-9" aria-busy={busy}>
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm shadow-sky-200">
            <FlaskConical aria-hidden="true" className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">BeverageAI <span className="text-sky-700">DZ</span></h1>
          <p className="mt-1 text-sm text-slate-500">Secure industrial R&amp;D workspace</p>
        </div>

        <div role="tablist" aria-label="Authentication mode" className="mb-6 grid grid-cols-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
          {(['signin', 'signup'] as const).map(value => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setError(''); setMessage(''); }}
              className={`rounded-xl px-3 py-2.5 text-sm font-bold transition ${mode === value ? 'bg-white text-sky-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'}`}>
              {value === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm font-semibold text-slate-700">
              Display name
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} required
                className="input mt-1.5" />
            </label>
          )}
          <label className="block text-sm font-semibold text-slate-700">
            Email
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email"
              className="input mt-1.5" />
          </label>
          {mode !== 'reset' && (
            <label className="block text-sm font-semibold text-slate-700">
              Password
              <input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="input mt-1.5" />
            </label>
          )}
          {mode === 'signin' && (
            <button type="button" onClick={() => { setMode('reset'); setError(''); setMessage(''); }}
              className="text-sm font-medium text-sky-700 hover:text-sky-900">
              Forgot your password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" onClick={() => { setMode('signin'); setError(''); setMessage(''); }}
              className="text-sm font-medium text-sky-700 hover:text-sky-900">
              Back to sign in
            </button>
          )}
          <StatusMessage error={error} message={message} />
          <button type="submit" disabled={busy}
            className="primary-button w-full justify-center">
            {busy && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}
          </button>
        </form>
      </div>
    </div>
  );
}
