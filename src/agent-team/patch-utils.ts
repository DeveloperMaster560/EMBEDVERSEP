export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function applyExactReplacement(source: string, searchText: string, replaceText: string): string {
  const first = source.indexOf(searchText);
  if (!searchText || first < 0 || source.indexOf(searchText, first + searchText.length) >= 0) throw new Error('PATCH_STALE: El fragmento ya no aparece exactamente una vez.');
  return source.slice(0, first) + replaceText + source.slice(first + searchText.length);
}
