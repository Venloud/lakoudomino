import { useEffect, useState } from 'react';
import { Waves, Sun } from 'lucide-react';

export type TableTheme = 'lakou' | 'beach';
const STORAGE_KEY = 'caribbean-domino-theme';

export function useTableTheme() {
  const [theme, setTheme] = useState<TableTheme>(() => {
    if (typeof window === 'undefined') return 'lakou';
    return window.localStorage.getItem(STORAGE_KEY) === 'beach' ? 'beach' : 'lakou';
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

export function TableThemeSwitcher({ theme, onChange }: { theme: TableTheme; onChange: (theme: TableTheme) => void }) {
  return (
    <div className="theme-switcher" aria-label="Choose table scene" data-testid="control-table-theme">
      <span className="theme-switcher-label">Scene</span>
      <button type="button" className={theme === 'lakou' ? 'theme-choice active' : 'theme-choice'} onClick={() => onChange('lakou')} data-testid="button-theme-lakou">
        <Sun size={13} /> Lakou
      </button>
      <button type="button" className={theme === 'beach' ? 'theme-choice active' : 'theme-choice'} onClick={() => onChange('beach')} data-testid="button-theme-beach">
        <Waves size={13} /> Beach
      </button>
    </div>
  );
}

export function SceneDecor() {
  return (
    <>
      <div className="scene-palm scene-palm-left" aria-hidden="true"><i /><b /><span /></div>
      <div className="scene-palm scene-palm-right" aria-hidden="true"><i /><b /><span /></div>
    </>
  );
}

export function PatioChair({ className = '' }: { className?: string }) {
  return <span className={`patio-chair ${className}`} aria-hidden="true"><i /><b /><em /></span>;
}
