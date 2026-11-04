import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dominoAssetUrl, dominoStyleKey, loadDominoStyle, saveDominoStyle } from '../ui/domino-style.ts';

test('all three styles include every double-six image', () => {
  const styles = ['playing-cards', 'black-on-white', 'white-on-black'] as const;
  for (const style of styles) {
    const [width, height] = style === 'playing-cards' ? [960, 1920] : [560, 1120];
    for (let first = 0; first <= 6; first += 1) {
      for (let second = first; second <= 6; second += 1) {
        const filename = style === 'playing-cards' ? (first === 0 && second > 0 ? `${second}x0` : `${first}x${second}`) : `${first}-${second}`;
        assert.equal(dominoAssetUrl(first, second, style), `/domino-assets/${style}/${filename}.png`);
        assert.equal(dominoAssetUrl(second, first, style), `/domino-assets/${style}/${filename}.png`);
        const image = readFileSync(new URL(`../../artifacts/caribbean-dominoes/public${dominoAssetUrl(first, second, style)}`, import.meta.url));
        assert.equal(image.toString('ascii', 1, 4), 'PNG');
        assert.equal(image.readUInt32BE(16), width);
        assert.equal(image.readUInt32BE(20), height);
      }
    }
  }
});

test('domino style defaults to the playing-cards art and preserves each explicit choice', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(loadDominoStyle('Mireille', storage), 'playing-cards');
  saveDominoStyle('Mireille', 'white-on-black', storage);
  assert.equal(loadDominoStyle('Mireille', storage), 'white-on-black');
  assert.equal(loadDominoStyle('  MIREILLE ', storage), 'white-on-black');
  saveDominoStyle('Mireille', 'black-on-white', storage);
  assert.equal(loadDominoStyle('Mireille', storage), 'black-on-white');
  assert.equal(loadDominoStyle('Jean', storage), 'playing-cards');
  assert.equal(dominoStyleKey('Mireille'), 'lakou-domino-style:mireille');
});
