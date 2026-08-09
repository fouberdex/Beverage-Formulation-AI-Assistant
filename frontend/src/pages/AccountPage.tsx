import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { accountAPI } from '../services/api';

export default function AccountPage() {
  const { profile, recoveryMode, session, updateDisplayName, updatePassword } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<'profile' | 'password' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => setDisplayName(profile?.display_name || ''), [profile?.display_name]);
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    void accountAPI.getUsers().then(response => setUsers(response.data.data))
      .catch((cause: any) => setError(cause?.response?.data?.error || 'Unable to load users'));
  }, [profile?.role]);

  async function changeRole(userId: string, role: string) {
    setError(''); setMessage('');
    try {
      const response = await accountAPI.updateUserRole(userId, role);
      setUsers(current => current.map(user => user.id === userId ? { ...user, ...response.data.data } : user));
      setMessage('User role updated.');
    } catch (cause: any) {
      setError(cause?.response?.data?.error || 'Unable to update user role');
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy('profile'); setError(''); setMessage('');
    try {
      await updateDisplayName(displayName.trim());
      setMessage('Profile updated.');
    } catch (cause: any) {
      setError(cause?.response?.data?.error || cause?.message || 'Unable to update profile');
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (password !== confirmPassword) return setError('The passwords do not match.');
    setBusy('password');
    try {
      await updatePassword(password);
      setPassword(''); setConfirmPassword('');
      setMessage('Password updated.');
    } catch (cause: any) {
      setError(cause?.message || 'Unable to update password');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="px-1 py-5">
        <h1 className="text-3xl font-bold text-gray-900">Account</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your profile and sign-in password.</p>
      </div>

      {recoveryMode && <p className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">Password recovery verified. Choose a new password below.</p>}
      {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>}

      <form onSubmit={saveProfile} className="rounded-lg bg-white p-6 shadow">
        <div className="mb-5 flex items-center gap-3">
          <UserRound className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">Display name
            <input value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={100}
              className="mt-1 w-full rounded-md border border-gray-300 p-2.5" />
          </label>
          <label className="text-sm font-medium text-gray-700">Email
            <input value={session?.user.email || ''} disabled className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 p-2.5 text-gray-500" />
          </label>
          <label className="text-sm font-medium text-gray-700">Access role
            <input value={profile?.role || 'Loading…'} disabled className="mt-1 w-full capitalize rounded-md border border-gray-200 bg-gray-50 p-2.5 text-gray-500" />
          </label>
        </div>
        <button disabled={busy !== null} className="mt-5 inline-flex items-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {busy === 'profile' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save profile
        </button>
      </form>

      <form onSubmit={savePassword} className="rounded-lg bg-white p-6 shadow">
        <div className="mb-5 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">New password
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-gray-300 p-2.5" />
          </label>
          <label className="text-sm font-medium text-gray-700">Confirm password
            <input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required minLength={8} autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-gray-300 p-2.5" />
          </label>
        </div>
        <button disabled={busy !== null} className="mt-5 inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {busy === 'password' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
        </button>
      </form>

      {profile?.role === 'admin' && (
        <section className="overflow-hidden rounded-lg bg-white shadow">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">User access</h2>
            <p className="text-xs text-gray-500">Administrators manage ingredients and users; formulators create formulations; viewers are read-only.</p>
          </div>
          {users.length === 0 ? <p className="p-6 text-sm text-gray-500">No user profiles found.</p> : (
            <div className="divide-y">{users.map(user => (
              <div key={user.id} className="grid items-center gap-3 px-6 py-4 sm:grid-cols-[1fr_12rem]">
                <div><p className="font-medium text-gray-900">{user.display_name || user.email || 'Unnamed user'}</p><p className="text-xs text-gray-500">{user.email}</p></div>
                <select value={user.role} onChange={event => void changeRole(user.id, event.target.value)}
                  className="rounded-md border border-gray-300 p-2 text-sm capitalize">
                  <option value="admin">Administrator</option>
                  <option value="formulator">Formulator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            ))}</div>
          )}
        </section>
      )}
    </div>
  );
}
