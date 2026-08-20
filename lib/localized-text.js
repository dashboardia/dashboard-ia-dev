export function resolveLocalizedText(previous, current, translations) {
  const source = previous?.rendered === current ? previous.source : current;
  const trimmed = source.trim();
  const translated = translations?.[trimmed] ?? trimmed;
  return { source, rendered: source.replace(trimmed, translated) };
}
