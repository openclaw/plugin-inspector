export function readFlag(commandArgs, name) {
  const index = commandArgs.indexOf(name);
  if (index === -1) {
    return null;
  }
  return commandArgs[index + 1] ?? null;
}

export function readMockSdkFlag(commandArgs) {
  const sdk = readFlag(commandArgs, "--sdk");
  if (sdk === "mock") {
    return true;
  }
  if (sdk === "real") {
    return false;
  }
  if (sdk && !["mock", "real"].includes(sdk)) {
    throw new Error("--sdk must be mock or real");
  }
  if (commandArgs.includes("--mock-sdk")) {
    return true;
  }
  if (commandArgs.includes("--real-sdk")) {
    return false;
  }
  return undefined;
}

export function findCaptureEntrypoint(commandArgs) {
  const flagsWithValues = new Set(["--output", "--plugin-root", "--sdk"]);
  const consumedIndexes = new Set();
  for (const [index, arg] of commandArgs.entries()) {
    if (flagsWithValues.has(arg)) {
      consumedIndexes.add(index + 1);
    }
  }
  return commandArgs.find((arg, index) => !arg.startsWith("-") && !consumedIndexes.has(index)) ?? null;
}
