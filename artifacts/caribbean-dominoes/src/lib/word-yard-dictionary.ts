const compressedWordList = new URL('./data/word-list.bin', import.meta.url);

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
