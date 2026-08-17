import { useEffect, useState } from 'react';
import { accountAPI, targetGenerationAPI } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import Pagination from '../components/Pagination';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function HistoryPage() {
  const { profile } = useAuth();
  const [runs, setRuns] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runPage, setRunPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [eventTotal, setEventTotal] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true); setError('');
    Promise.all([
      targetGenerationAPI.getRuns({ limit: pageSize, offset: (runPage - 1) * pageSize }),
      accountAPI.getAudit({ limit: pageSize, offset: (eventPage - 1) * pageSize }),
    ]).then(([runResponse, auditResponse]) => {
      setRuns(runResponse.data.data);
      setRunTotal(runResponse.data.pagination.total);
      setEvents(auditResponse.data.data);
      setEventTotal(auditResponse.data.pagination.total);
    }).catch(cause => setError(getErrorMessage(cause, 'Unable to load history.')))
      .finally(() => setLoading(false));
  }, [runPage, eventPage]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading history…</div>;

  return (
    <div className="space-y-7">
      <div className="px-1 py-5">
        <h1 className="text-3xl font-bold text-gray-900">History</h1>
        <p className="mt-1 text-sm text-gray-500">Your saved AI generation runs and API change log.</p>
      </div>
      <StatusMessage error={error} />

      <section className="overflow-hidden rounded-lg bg-white shadow">
        <h2 className="border-b px-5 py-4 text-lg font-semibold">Target generation runs</h2>
        {runs.length === 0 ? <p className="p-5 text-sm text-gray-500">No generation runs yet.</p> : (
          <div className="divide-y">
            {runs.map(run => <div key={run.id} className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-4">
              <span className="font-medium text-gray-900">{run.constraints?.beverage_type || 'Beverage'}</span>
              <span>{run.candidates?.length || 0} candidates</span>
              <span>{run.ai?.used ? `Gemini · ${run.ai.model}` : 'Local validation'}</span>
              <time className="text-gray-500 sm:text-right">{new Date(run.created_at).toLocaleString()}</time>
            </div>)}
          </div>
        )}
        <Pagination page={runPage} pageSize={pageSize} total={runTotal} onPageChange={setRunPage} label="Generation runs" />
      </section>

      <section className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Change log</h2>
          <p className="text-xs text-gray-500">Showing events attributed to {profile?.display_name || profile?.email || 'your account'}.</p>
        </div>
        {events.length === 0 ? <p className="p-5 text-sm text-gray-500">No recorded changes yet.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full divide-y text-sm">
            <caption className="sr-only">Account change log</caption>
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th scope="col" className="px-5 py-3">Time</th><th scope="col" className="px-5 py-3">Action</th><th scope="col" className="px-5 py-3">Entity</th><th scope="col" className="px-5 py-3">Result</th></tr></thead>
            <tbody className="divide-y">{events.map(event => <tr key={event.id}>
              <td className="whitespace-nowrap px-5 py-3 text-gray-500">{new Date(event.created_at).toLocaleString()}</td>
              <td className="px-5 py-3 font-medium uppercase">{event.action}</td>
              <td className="px-5 py-3">{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ''}</td>
              <td className="px-5 py-3">HTTP {event.metadata?.status_code || '—'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
        <Pagination page={eventPage} pageSize={pageSize} total={eventTotal} onPageChange={setEventPage} label="Change log" />
      </section>
    </div>
  );
}
