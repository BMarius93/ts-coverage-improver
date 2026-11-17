import { z } from 'zod';
import { TestPlan } from '../../../domain/job/test-plan';

/** The subset of `claude -p --output-format json` we rely on. */
export const claudeResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
});
export type ClaudeResult = z.infer<typeof claudeResultSchema>;

/** Shape the planner (and the single-call writer) must answer with. Domain rules are checked by TestPlan. */
export const testPlanSchema = z.object({
  testFilePath: z.string(),
  summary: z.string(),
  cases: z.array(z.object({ name: z.string(), covers: z.string().default('') })).min(1),
});

export class AiOutputError extends Error {}

export function parseClaudeResult(stdout: string): ClaudeResult {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new AiOutputError(`AI CLI did not return JSON: ${stdout.slice(0, 300)}`);
  }
  const parsed = claudeResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiOutputError(`Unexpected AI CLI output: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

/**
 * Extracts and validates the TestPlan from the model's final message. Tolerates Markdown fences or prose
 * around the JSON object, since models do not always follow "JSON only" instructions.
 */
export function extractTestPlan(text: string): TestPlan {
  const candidates = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = testPlanSchema.safeParse(json);
    if (!parsed.success) {
      throw new AiOutputError(
        `AI test plan has the wrong shape: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const plan = TestPlan.create(parsed.data);
    if (!plan.ok) {
      throw new AiOutputError(`AI test plan is invalid: ${plan.error.message}`);
    }
    return plan.value;
  }
  throw new AiOutputError(`AI did not return a JSON test plan: ${text.slice(0, 300)}`);
}
