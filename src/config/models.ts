export interface ModelDefaults {
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsWebSearch?: boolean;
  supportsThinking?: boolean;
  supportsAnnotations?: boolean;
  recommended?: boolean;
}

const MODEL_DEFAULTS: Record<string, ModelDefaults> = {
  'gpt-4o-mini': { contextWindowTokens: 128_000, maxOutputTokens: 16_000 },
  'gpt-4o': { contextWindowTokens: 128_000, maxOutputTokens: 16_000 },
  'gpt-4.1': { contextWindowTokens: 1_000_000, maxOutputTokens: 32_000 },
  'gpt-4.1-mini': { contextWindowTokens: 1_000_000, maxOutputTokens: 32_000 },
  'gpt-5': { contextWindowTokens: 400_000, maxOutputTokens: 128_000 },
  'gpt-5-mini': { contextWindowTokens: 400_000, maxOutputTokens: 128_000 },
  'deepseek-chat': { contextWindowTokens: 64_000, maxOutputTokens: 8_000 },
  'mimo-v2.5-pro': {
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_000,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsAnnotations: true,
    recommended: true,
  },
};

const FALLBACK_DEFAULT: ModelDefaults = {
  contextWindowTokens: 32_000,
  maxOutputTokens: 4_000,
};

export function getModelDefaults(model: string): ModelDefaults {
  return MODEL_DEFAULTS[model] ?? FALLBACK_DEFAULT;
}

export function getModelCapabilities(model: string): Required<Pick<
  ModelDefaults,
  'supportsWebSearch' | 'supportsThinking' | 'supportsAnnotations' | 'recommended'
>> {
  const defaults = getModelDefaults(model);

  return {
    supportsWebSearch: defaults.supportsWebSearch ?? false,
    supportsThinking: defaults.supportsThinking ?? false,
    supportsAnnotations: defaults.supportsAnnotations ?? false,
    recommended: defaults.recommended ?? false,
  };
}
