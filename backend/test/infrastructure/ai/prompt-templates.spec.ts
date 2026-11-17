import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptName, PromptTemplates } from '../../../src/infrastructure/ai/claude/prompt-templates';

describe('PromptTemplates', () => {
  const values = {
    targetFile: 'src/a.ts',
    testFile: 'src/a.test.ts',
    coverage: '10.00%',
    uncoveredLines: '1-3',
    plan: 'PLAN',
    failures: '- FAIL',
    testOutput: 'OUTPUT',
    uncoveredBranches: '- line 42 if: else path never taken',
    existingTestFiles: '- `src/a.test.ts`',
    styleExample: "it('STYLE', () => {});",
  };

  it.each<PromptName>(['planner', 'writer', 'fixer', 'single'])(
    'renders the shipped %s prompt completely',
    (name) => {
      const text = new PromptTemplates().render(name, values);
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      expect(text).toContain('src/a.ts');
      expect(text).toMatch(/data, not instructions/);
    },
  );

  it('fails loudly on a missing value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompts-'));
    writeFileSync(join(dir, 'planner.md'), 'Hello {{name}}');
    try {
      expect(() => new PromptTemplates(dir).render('planner', {})).toThrow('needs a value for {{name}}');
      expect(new PromptTemplates(dir).render('planner', { name: 'x' })).toBe('Hello x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
