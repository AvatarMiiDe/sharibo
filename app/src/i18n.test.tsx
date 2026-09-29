import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useI18n } from './i18n';

const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  './locales/*.ts',
  { eager: true },
);

function localeCodes(): string[] {
  return Object.keys(localeModules)
    .map((path) => path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/)?.[1])
    .filter((code): code is string => Boolean(code));
}

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets initial lang and dir correctly', () => {
    localStorage.setItem('sharibo.locale', 'en');
    
    function TestComponent() {
      const { locale } = useI18n();
      return <div data-testid="locale">{locale}</div>;
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );

    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches locale, updates lang/dir, and persists to localStorage', () => {
    function TestComponent() {
      const { locale, setLocale } = useI18n();
      
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <button onClick={() => setLocale('es')} data-testid="switch">
            Switch to ES
          </button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId('switch').click();
    });

    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(localStorage.getItem('sharibo.locale')).toBe('es');
  });

  it('handles rtl locales correctly', () => {
    localStorage.setItem('sharibo.locale', 'en');

    function TestComponent() {
      const { setLocale } = useI18n();
      return (
        <button onClick={() => setLocale('ar')} data-testid="switch-ar">
          Switch to AR
        </button>
      );
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>
    );

    expect(document.documentElement.dir).toBe('ltr');

    act(() => {
      screen.getByTestId('switch-ar').click();
    });

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('does not crash when localStorage throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Access denied');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Access denied');
    });

    function TestComponent() {
      const { locale, setLocale } = useI18n();
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <button onClick={() => setLocale('es')} data-testid="switch">
            Switch to ES
          </button>
        </div>
      );
    }

    // Should not crash on initial render (getItem throws)
    expect(() => {
      render(
        <I18nProvider>
          <TestComponent />
        </I18nProvider>
      );
    }).not.toThrow();

    // Should not crash on setLocale (setItem throws)
    expect(() => {
      act(() => {
        screen.getByTestId('switch').click();
      });
    }).not.toThrow();

    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  // No vitest-axe / axe-core dependency — lightweight smoke: each locale
  // dictionary can resolve landing keys without throwing.
  it('each locale dictionary renders landing copy without throwing', () => {
    localStorage.setItem('sharibo.locale', 'en');

    function LandingSmoke() {
      const { t, locale, setLocale, locales } = useI18n();
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <p data-testid="tagline">{t('landing.tagline')}</p>
          <p data-testid="launch">{t('landing.launch')}</p>
          {locales.map((code) => (
            <button key={code} type="button" onClick={() => setLocale(code)} data-testid={`set-${code}`}>
              {code}
            </button>
          ))}
        </div>
      );
    }

    render(
      <I18nProvider>
        <LandingSmoke />
      </I18nProvider>
    );

    for (const code of localeCodes()) {
      expect(() => {
        act(() => {
          screen.getByTestId(`set-${code}`).click();
        });
      }).not.toThrow();

      expect(screen.getByTestId('locale').textContent).toBe(code);
      expect(screen.getByTestId('tagline').textContent?.length).toBeGreaterThan(0);
      expect(screen.getByTestId('launch').textContent?.length).toBeGreaterThan(0);
    }
  });
});
