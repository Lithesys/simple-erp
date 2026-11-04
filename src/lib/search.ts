export function normalizeSearchText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi");
}

export function getSearchTokens(query: string) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function getPhraseTokens(value: string) {
  return normalizeSearchText(value).match(/[a-z0-9]+/g) ?? [];
}

export function matchesSearchPhrase(text: string, query: string) {
  const phraseTokens = getPhraseTokens(query);
  if (phraseTokens.length < 2) return false;

  const textTokens = getPhraseTokens(text);
  return textTokens.some((_, start) =>
    phraseTokens.every((token, offset) => textTokens[start + offset] === token),
  );
}

export function matchesSearchQuery(text: string, query: string) {
  const tokens = getSearchTokens(query);
  if (!tokens.length) return true;

  const normalizedText = normalizeSearchText(text);
  return tokens.every((token) => normalizedText.includes(token));
}
