/**
 * Variables a child process may inherit. Everything else — notably GITHUB_TOKEN and other secrets — is
 * dropped, so tools that run untrusted code (npm, jest, the AI agent) never see them.
 */
const BASE_ALLOW_LIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TZ',
  'SHELL',
  'TERM',
];

export function childEnv(
  extra: Record<string, string | undefined> = {},
  options: { inherit?: string[]; source?: NodeJS.ProcessEnv } = {},
): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const name of [...BASE_ALLOW_LIST, ...(options.inherit ?? [])]) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) env[name] = value;
  }
  return env;
}
