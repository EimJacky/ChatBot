import { describe, expect, it } from 'vitest';
import { validateContainer } from '../src/config/container.js';

describe('validateContainer', () => {
  it('throws when a service is missing', () => {
    expect(() => validateContainer({})).toThrow(/Missing/);
  });
});

