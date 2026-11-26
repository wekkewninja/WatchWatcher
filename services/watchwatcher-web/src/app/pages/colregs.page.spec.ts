import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { ColregsRule } from '../domain-types';
import { ColregsPage } from './colregs.page';

afterEach(() => vi.restoreAllMocks());

describe('ColregsPage', () => {
  it('starts a lookup during initialization', () => {
    const page = new ColregsPage();
    const search = vi.spyOn(page, 'search').mockResolvedValue();

    page.ngOnInit();

    expect(search).toHaveBeenCalledOnce();
  });

  it('searches with the current query and exposes matching rules', async () => {
    const search = vi.spyOn(api, 'searchColregs').mockResolvedValue([
      { id: 'rule-5', ruleNumber: 'Rule 5' } as unknown as ColregsRule,
    ]);
    const page = new ColregsPage();
    page.query = 'lookout';

    await page.search();

    expect(search).toHaveBeenCalledWith('lookout');
    expect(page.rules().map((rule) => rule.id)).toEqual(['rule-5']);
    expect(page.loading()).toBe(false);
    expect(page.error()).toBe('');
  });

  it('reports an empty result and clears the query before searching again', async () => {
    const search = vi.spyOn(api, 'searchColregs').mockResolvedValue([]);
    const page = new ColregsPage();
    page.query = 'no matching rule';

    await page.search();
    expect(page.rules()).toEqual([]);
    expect(page.loading()).toBe(false);

    page.clearSearch();
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith(''));
    await vi.waitFor(() => expect(page.loading()).toBe(false));
    expect(page.query).toBe('');
  });

  it('displays errors and restores loading state', async () => {
    vi.spyOn(api, 'searchColregs').mockRejectedValue(new Error('Reference offline'));
    const page = new ColregsPage();

    await page.search();

    expect(page.error()).toBe('Reference offline');
    expect(page.loading()).toBe(false);
  });

  it('uses fallback feedback for non-Error lookup failures', async () => {
    vi.spyOn(api, 'searchColregs').mockRejectedValue('offline');
    const page = new ColregsPage();

    await page.search();

    expect(page.error()).toBe('Try again in a moment.');
    expect(page.loading()).toBe(false);
  });
});