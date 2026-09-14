import { useState } from 'react';
import { BookOpenCheck, ExternalLink, RefreshCw, Server } from 'lucide-react';

const ragUrl = import.meta.env.VITE_RAG_URL || 'http://127.0.0.1:8503';

export default function RagWorkspacePage() {
  const [frameKey, setFrameKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  return <div className="space-y-5 pb-8">
    <header className="hero-panel"><div><span className="hero-kicker"><BookOpenCheck className="h-4 w-4"/> Evidence workspace</span><h1>Patent & Publication RAG</h1><p>Open the technical evidence assistant inside BeverageAI DZ while keeping retrieval status visible.</p></div><div className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${loaded ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}><Server className="mr-1 inline h-3.5 w-3.5"/>{loaded ? 'Frame loaded' : 'Waiting for RAG server'}</div></header>
    <div className="surface-card flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">Configured endpoint</p><code className="text-xs text-slate-500">{ragUrl}</code></div><div className="flex gap-2"><button type="button" onClick={() => { setLoaded(false); setFrameKey(key => key + 1); }} className="secondary-button"><RefreshCw className="h-4 w-4"/>Reconnect</button><a href={ragUrl} target="_blank" rel="noreferrer" className="primary-button"><ExternalLink className="h-4 w-4"/>Open separately</a></div></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"><iframe key={frameKey} title="BeverageAI evidence RAG" src={ragUrl} onLoad={() => setLoaded(true)} className="h-[calc(100vh-15rem)] min-h-[680px] w-full"/></div>
    <p className="text-xs text-slate-500">If the embedded server is unavailable, start the RAG service and use Reconnect. Its lifecycle remains independent from the main application so a GPU/tunnel failure cannot crash BeverageAI DZ.</p>
  </div>;
}
