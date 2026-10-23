export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1_000;
  const idx = t.indexOf(q);
  if (idx === 0) return 500 - Math.min(t.length, 100);
  if (idx > 0) return 200 - Math.min(idx, 50);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === ti ? 3 : 1;
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((row): row is { item: T; score: number } => row.score != null)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item);
}
