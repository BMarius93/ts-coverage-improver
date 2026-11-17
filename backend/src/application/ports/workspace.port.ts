/** Scratch directories on the local disk for scans and jobs. */
export interface WorkspacePort {
  /** Creates a fresh, empty directory and returns its absolute path. */
  create(kind: 'scan' | 'job', id: string): Promise<string>;
  remove(dir: string): Promise<void>;
  /** Deletes the given repo-relative paths if present and returns the ones that existed. */
  removePaths(dir: string, relativePaths: string[]): Promise<string[]>;
}

export const WORKSPACE_PORT = Symbol('WorkspacePort');
