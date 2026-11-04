export function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index];
}

export function assertRunCount(runs, max) {
  if (!Number.isInteger(runs) || runs < 1 || runs > max) {
    throw new Error(`runs must be an integer between 1 and ${max}`);
  }
}

export function sortedMetric(samples, field) {
  return samples.map((sample) => sample[field]).sort((left, right) => left - right);
}
