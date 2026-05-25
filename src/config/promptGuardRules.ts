import { readFileSync } from 'node:fs';
import { z } from 'zod';

const rulesSchema = z.object({
  denyPatterns: z.array(z.string()),
  denyMessage: z.string().min(1),
});

export type PromptGuardRules = z.infer<typeof rulesSchema>;

export function loadPromptGuardRules(path = 'config/prompt-guard-rules.json'): PromptGuardRules {
  const raw = readFileSync(path, 'utf8');
  return rulesSchema.parse(JSON.parse(raw));
}

