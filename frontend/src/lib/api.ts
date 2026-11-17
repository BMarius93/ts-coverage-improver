import type { FileRow, Job, Repository } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  listRepositories: () => call<Repository[]>('/repositories'),
  registerRepository: (url: string) =>
    call<Repository>('/repositories', { method: 'POST', body: JSON.stringify({ url }) }),
  scan: (repositoryId: string) => call<Repository>(`/repositories/${repositoryId}/scan`, { method: 'POST' }),
  listFiles: (repositoryId: string, belowThreshold: boolean) =>
    call<FileRow[]>(`/repositories/${repositoryId}/files${belowThreshold ? '?belowThreshold=true' : ''}`),
  requestImprovement: (repositoryId: string, filePath: string) =>
    call<Job>('/jobs', { method: 'POST', body: JSON.stringify({ repositoryId, filePath }) }),
  getJob: (jobId: string) => call<Job>(`/jobs/${jobId}`),
};
