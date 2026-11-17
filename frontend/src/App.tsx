import { useCallback, useState } from 'react';
import { AddRepositoryForm } from './components/AddRepositoryForm';
import { FilesTable } from './components/FilesTable';
import { JobDrawer } from './components/JobDrawer';
import { RepositoryList } from './components/RepositoryList';
import { api } from './lib/api';
import { pollInterval } from './lib/format';
import type { FileRow, Job, Repository } from './lib/types';
import { usePolling } from './lib/usePolling';

export function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [belowOnly, setBelowOnly] = useState(true);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const selected = repositories.find((repo) => repo.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const repos = await api.listRepositories();
      setRepositories(repos);
      const current = selectedId ?? repos[0]?.id ?? null;
      if (current !== selectedId) setSelectedId(current);
      setFiles(current ? await api.listFiles(current, belowOnly) : []);
      if (openJob) {
        const fresh = await api.getJob(openJob.id);
        // Only update if the drawer still shows this job (the user may have closed it meanwhile).
        setOpenJob((current) => (current?.id === fresh.id ? fresh : current));
      }
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [selectedId, belowOnly, openJob]);

  usePolling(refresh, pollInterval(repositories, files, openJob), `${selectedId}-${belowOnly}`);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>TS Coverage Improver</h1>
          <p className="muted">
            Scan GitHub repositories, then let an AI agent open pull requests with tests.
          </p>
        </div>
        {offline && <span className="offline">Backend unreachable — retrying…</span>}
      </header>

      <AddRepositoryForm
        onSubmit={(url) =>
          run(async () => {
            const repo = await api.registerRepository(url);
            setSelectedId(repo.id);
          })
        }
      />

      {error && (
        <div className="alert" role="alert">
          {error}
          <button type="button" className="link" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <main className="layout">
        <RepositoryList
          repositories={repositories}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onScan={(id) => void run(() => api.scan(id))}
        />
        {selected && (
          <FilesTable
            repository={selected}
            files={files}
            belowOnly={belowOnly}
            onToggleBelowOnly={setBelowOnly}
            onImprove={(path) =>
              void run(async () => {
                const job = await api.requestImprovement(selected.id, path);
                setOpenJob(job);
              })
            }
            onOpenJob={(jobId) => void run(async () => setOpenJob(await api.getJob(jobId)))}
          />
        )}
      </main>

      <JobDrawer job={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
