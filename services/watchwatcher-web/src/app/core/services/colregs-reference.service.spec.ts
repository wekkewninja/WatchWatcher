import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { ColregsReferenceService } from './colregs-reference.service';

afterEach(() => vi.restoreAllMocks());

describe('ColregsReferenceService', () => {
  it('forwards search queries to the bundled API reference client', async () => {
    const search = vi.spyOn(api, 'searchColregs').mockResolvedValue([]);
    await expect(new ColregsReferenceService().search('sound signals')).resolves.toEqual([]);
    expect(search).toHaveBeenCalledWith('sound signals');
  });
});