export default function StatusMessage({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (message) return <p role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>;
  return null;
}
