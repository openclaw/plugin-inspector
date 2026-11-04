export function printChecks(checks) {
  for (const check of checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.status === "fail" && check.actual !== check.expected) {
      console.log(`  expected: ${check.expected}`);
      console.log(`  actual: ${check.actual}`);
    }
  }
}
