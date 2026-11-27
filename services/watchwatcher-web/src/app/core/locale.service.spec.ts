import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { englishCatalog, LocaleService } from './locale.service';

describe('LocaleService', () => {
  afterEach(() => {
    localStorage.removeItem('app-locale');
    TestBed.resetTestingModule();
  });

  it('resolves every English catalog key and interpolates named values', () => {
    const locales = TestBed.inject(LocaleService);

    for (const key of Object.keys(englishCatalog)) {
      const message = englishCatalog[key as keyof typeof englishCatalog];
      const parameters = Object.fromEntries([...message.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(([, name]) => [name, name === 'name' ? 'Sailor' : 'sample']));
      expect(locales.translate(key as keyof typeof englishCatalog, parameters)).toBe(message.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => String(parameters[name])));
    }
    expect(locales.translate('app.toolbar.accountSettings', { name: 'Sailor' })).toBe('Account settings for Sailor');
  });

  it('throws for missing keys and missing interpolation values', () => {
    const locales = TestBed.inject(LocaleService);

    expect(() => locales.translate('app.unknown' as keyof typeof englishCatalog)).toThrow('Missing English translation: app.unknown');
    expect(() => locales.translate('app.toolbar.accountSettings')).toThrow('Missing interpolation value "name"');
  });

  it('defaults to English and persists the explicit selection', () => {
    const locales = TestBed.inject(LocaleService);

    expect(locales.locale()).toBe('en');
    locales.setLocale('en');
    expect(locales.locale()).toBe('en');
    expect(localStorage.getItem('app-locale')).toBe('en');
    expect(() => locales.setLocale('fr')).toThrow('Unsupported locale: fr');
  });

  it('defaults to English when the saved locale is unknown', () => {
    localStorage.setItem('app-locale', 'fr');
    expect(TestBed.inject(LocaleService).locale()).toBe('en');
  });

  it('restores a previously persisted English selection', () => {
    localStorage.setItem('app-locale', 'en');
    expect(TestBed.inject(LocaleService).locale()).toBe('en');
  });
});