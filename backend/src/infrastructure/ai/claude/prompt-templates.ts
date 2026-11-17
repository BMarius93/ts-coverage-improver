import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  private load(name: PromptName): string {
    let template = this.cache.get(name);
    if (template === undefined) {
      template = readFileSync(join(this.dir, `${name}.md`), 'utf8');
      this.cache.set(name, template);
    }
    return template;
  }
}
