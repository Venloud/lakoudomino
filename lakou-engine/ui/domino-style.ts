export type DominoStyle = 'playing-cards' | 'black-on-white' | 'white-on-black';
export const DEFAULT_DOMINO_STYLE: DominoStyle = 'playing-cards';

export function dominoAssetUrl(first: number, second: number, style: DominoStyle) {
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  if (style === 'playing-cards') {
    const filename = low === 0 && high > 0 ? `${high}x0` : `${low}x${high}`;
    return `/domino-assets/${style}/${filename}.png`;
  }
  return `/domino-assets/${style}/${low}-${high}.png`;
}

export interface DominoStyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function dominoStyleKey(playerName: string) {
  const identity = playerName.trim().toLocaleLowerCase() || 'guest';
  return `lakou-domino-style:${identity}`;
}

export function loadDominoStyle(playerName: string, storage?: DominoStyleStorage): DominoStyle {
  try {
    const value = storage?.getItem(dominoStyleKey(playerName));
    return value === 'playing-cards' || value === 'black-on-white' || value === 'white-on-black' ? value : DEFAULT_DOMINO_STYLE;
  } catch {
    return DEFAULT_DOMINO_STYLE;
  }
}

export function saveDominoStyle(playerName: string, style: DominoStyle, storage?: DominoStyleStorage) {
  try {
    storage?.setItem(dominoStyleKey(playerName), style);
  } catch {
    // Keep the selected style active for this session if browser storage is unavailable.
  }
}
