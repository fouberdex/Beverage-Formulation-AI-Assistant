import { Loader2 } from 'lucide-react';

export function InlineSpinner({label='Loading'}:{label?:string}){return <span role="status" className="inline-flex items-center gap-2 text-sm font-semibold text-secondary"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/><span>{label}</span></span>}
export function Skeleton({className='h-4 w-full'}:{className?:string}){return <span aria-hidden="true" className={`skeleton block rounded-lg ${className}`}/>}
export function CardSkeleton({count=3}:{count?:number}){return <div role="status" aria-label="Loading records" className="grid gap-3 md:grid-cols-2">{Array.from({length:count},(_,index)=><div key={index} className="surface-card space-y-3"><Skeleton className="h-3 w-24"/><Skeleton className="h-6 w-2/3"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-4/5"/></div>)}</div>}
export function LoadingState({label='Loading workspace…'}:{label?:string}){return <div role="status" aria-live="polite" className="flex min-h-56 items-center justify-center"><InlineSpinner label={label}/></div>}
