'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { translations, detectLanguage, type Language, type TranslationKey } from '@/lib/i18n';

type LanguageContextValue = {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'plts-lang';

function getInitialLang(): Language {
  if (typeof localStorage === 'undefined') return 'id';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'id' || stored === 'en') return stored;
  return detectLanguage();
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLang);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, l);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l;
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey) => {
      return translations[lang][key] ?? key;
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
