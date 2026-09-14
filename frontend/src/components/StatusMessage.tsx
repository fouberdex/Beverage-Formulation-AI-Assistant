export default function StatusMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 shadow-sm">{error}</p>;
  if (message) return <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm">{message}</p>;
  return null;
}
