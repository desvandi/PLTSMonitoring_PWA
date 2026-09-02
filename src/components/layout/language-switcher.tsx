'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import type { Language } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  const langs: { value: Language; label: string; flag: string }[] = [
    { value: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
    { value: 'en', label: 'English', flag: '🇬🇧' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Language">
          <Globe className="h-4 w-4" />
          <span className="sr-only">Language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {langs.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLang(l.value)}
            className={lang === l.value ? 'bg-accent' : ''}
          >
            <span className="mr-2 text-base">{l.flag}</span>
            {l.label}
            {lang === l.value && (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
