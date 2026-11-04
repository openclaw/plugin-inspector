export function dedupeBy(values, keyForValue) {
  const output = new Map();
  for (const value of values) {
    output.set(keyForValue(value), value);
  }
  return [...output.values()];
}

export function unique(values) {
  return [...new Set(values)];
}
