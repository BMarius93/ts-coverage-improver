import { useState, type FormEvent } from 'react';

export function AddRepositoryForm({ onSubmit }: { onSubmit: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      await onSubmit(url.trim());
      setUrl('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-repo" onSubmit={(event) => void submit(event)}>
      <input
        type="url"
        placeholder="https://github.com/owner/repository"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        aria-label="GitHub repository URL"
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add repository'}
      </button>
    </form>
  );
}
