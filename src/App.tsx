import { derive } from './lib/derive';
import { useRoadmapState } from './lib/useRoadmapState';
import { RoadmapView } from './RoadmapView';

export function App() {
  const { state, connection, refresh, setRef, setRoadmap } = useRoadmapState();

  if (!state?.roadmap) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <div className="h-8 w-72 animate-pulse rounded bg-zinc-900" />
        <div className="mt-3 h-4 w-96 animate-pulse rounded bg-zinc-900" />
        <div className="mt-10 space-y-6">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-5">
              <div className="h-5 w-6 animate-pulse rounded bg-zinc-900" />
              <div className="h-5 flex-1 animate-pulse rounded bg-zinc-900" style={{ opacity: 1 - i * 0.1 }} />
              <div className="h-5 w-20 animate-pulse rounded bg-zinc-900" />
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm text-zinc-600">
          {connection === 'connecting' ? 'reading git, gh and ~/.claude…' : 'server not reachable — is it running?'}
        </p>
      </div>
    );
  }

  const { views } = derive(state);
  return <RoadmapView views={views} fx={state} connection={connection} onRefresh={refresh} onPickRef={setRef} onPickRoadmap={setRoadmap} />;
}
