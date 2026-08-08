import { FormEvent, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
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
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const signedIn = await signUp(email.trim(), password, displayName.trim());
        if (!signedIn) setMessage('Account created. Check your email to confirm the account, then sign in.');
      }
    } catch (submissionError: any) {
      setError(submissionError?.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-600 text-white">
            <FlaskConical className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">BeverageAI DZ</h1>
          <p className="mt-1 text-sm text-gray-500">Secure formulation workspace</p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
          {(['signin', 'signup'] as const).map(value => (
            <button key={value} type="button" onClick={() => { setMode(value); setError(''); setMessage(''); }}
              className={`rounded-md px-3 py-2 text-sm font-medium ${mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {value === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm font-medium text-gray-700">
              Display name
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} required
                className="mt-1 w-full rounded-md border border-gray-300 p-2.5 focus:border-sky-500 focus:ring-sky-500" />
            </label>
          )}
          <label className="block text-sm font-medium text-gray-700">
            Email
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email"
              className="mt-1 w-full rounded-md border border-gray-300 p-2.5 focus:border-sky-500 focus:ring-sky-500" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Password
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="mt-1 w-full rounded-md border border-gray-300 p-2.5 focus:border-sky-500 focus:ring-sky-500" />
          </label>
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
          <button type="submit" disabled={busy}
            className="flex w-full items-center justify-center rounded-md bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-700 disabled:opacity-60">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
