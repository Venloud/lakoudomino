const compressedWordList = new URL('./data/word-list.bin', import.meta.url);

export type WordDefinition = { partOfSpeech: string; definition: string; sourceUrl?: string };

export async function lookupWordDefinitions(word: string): Promise<WordDefinition[] | null> {
  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Definition lookup failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The dictionary returned an unexpected response.');
  const definitions = payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const sourceUrls = (entry as { sourceUrls?: unknown }).sourceUrls;
    const sourceUrl = Array.isArray(sourceUrls) ? sourceUrls.find((url): url is string => typeof url === 'string') : undefined;
    if (!Array.isArray((entry as { meanings?: unknown }).meanings)) return [];
    return (entry as { meanings: unknown[] }).meanings.flatMap((meaning) => {
      if (!meaning || typeof meaning !== 'object' || !Array.isArray((meaning as { definitions?: unknown }).definitions)) return [];
      const partOfSpeech = typeof (meaning as { partOfSpeech?: unknown }).partOfSpeech === 'string'
        ? (meaning as { partOfSpeech: string }).partOfSpeech
        : 'word';
      return (meaning as { definitions: unknown[] }).definitions.flatMap((definition) => {
        const text = definition && typeof definition === 'object' ? (definition as { definition?: unknown }).definition : null;
        return typeof text === 'string' && text.trim() ? [{ partOfSpeech, definition: text.trim(), sourceUrl }] : [];
      });
    });
  });
  return definitions.length ? definitions.slice(0, 8) : null;
}

export async function loadWordDictionary(): Promise<ReadonlySet<string>> {
  const response = await fetch(compressedWordList);
  if (!response.ok || !response.body) {
    throw new Error(`The Word Yard dictionary could not be loaded (${response.status}).`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support the compressed Word Yard dictionary.');
  }
  const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
  const words = await new Response(decompressed).text();
  return new Set(words.split(/\s+/).filter((word) => word.length >= 2 && word.length <= 15));
}
