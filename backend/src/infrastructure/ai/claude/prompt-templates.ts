import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRUNCATION_MARKER = '\n… (truncated to fit the prompt size limit)';

export type PromptName = 'planner' | 'writer' | 'fixer' | 'single';

/** Loads `prompts/<name>.md` and fills `{{placeholders}}`. Unknown placeholders are an error (typo guard). */
export class PromptTemplates {
  private readonly cache = new Map<PromptName, string>();

  constructor(private readonly dir = join(__dirname, 'prompts')) {}

  render(name: PromptName, values: Record<string, string>): string {
    const template = this.load(name);
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Prompt ${name} needs a value for {{${key}}}`);
      }
      return value;
    });
  }

  /**
   * Renders and keeps the prompt within `maxChars` by shortening the values named in `shrinkOrder` (first one
   * first, from the end), down to a short marker. Fixed instructions are never cut.
   */
  renderWithinLimit(
    name: PromptName,
    values: Record<string, string>,
    maxChars: number,
    shrinkOrder: string[],
  ): string {
    const current = { ...values };
    let text = this.render(name, current);
    for (const key of shrinkOrder) {
      const excess = text.length - maxChars;
      if (excess <= 0) break;
      const value = current[key] ?? '';
      const keep = value.length - excess - TRUNCATION_MARKER.length;
      current[key] = keep > 0 ? `${value.slice(0, keep)}${TRUNCATION_MARKER}` : TRUNCATION_MARKER.trim();
      text = this.render(name, current);
    }
    return text;
  }

  private load(name: PromptName): string {
    let template = this.cache.get(name);
    if (template === undefined) {
      template = readFileSync(join(this.dir, `${name}.md`), 'utf8');
      this.cache.set(name, template);
    }
    return template;
  }
}
