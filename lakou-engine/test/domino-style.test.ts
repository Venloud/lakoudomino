import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dominoAssetUrl, dominoStyleKey, loadDominoStyle, saveDominoStyle } from '../ui/domino-style.ts';

test('both styles include every 560×1120 double-six image', () => {
  const styles = ['black-on-white', 'white-on-black'] as const;
  for (const style of styles) {
    for (let first = 0; first <= 6; first += 1) {
      for (let second = first; second <= 6; second += 1) {
        assert.equal(dominoAssetUrl(first, second, style), `/domino-assets/${style}/${first}-${second}.png`);
        assert.equal(dominoAssetUrl(second, first, style), `/domino-assets/${style}/${first}-${second}.png`);
        const image = readFileSync(new URL(`../../artifacts/caribbean-dominoes/public${dominoAssetUrl(first, second, style)}`, import.meta.url));
        assert.equal(image.toString('ascii', 1, 4), 'PNG');
        assert.equal(image.readUInt32BE(16), 560);
        assert.equal(image.readUInt32BE(20), 1120);
      }
    }
  }
});

test('domino style defaults to black on white and persists by player name', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(loadDominoStyle('Mireille', storage), 'black-on-white');
  saveDominoStyle('Mireille', 'white-on-black', storage);
  assert.equal(loadDominoStyle('Mireille', storage), 'white-on-black');
  assert.equal(loadDominoStyle('  MIREILLE ', storage), 'white-on-black');
  assert.equal(loadDominoStyle('Jean', storage), 'black-on-white');
  assert.equal(dominoStyleKey('Mireille'), 'lakou-domino-style:mireille');
});
