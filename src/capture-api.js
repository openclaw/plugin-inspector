export function createCaptureApi(options = {}) {
  const captured = [];
  const retained = [];
  const knownRegistrars = new Set(options.knownRegistrars ?? []);
  const retainHandlers = options.retainHandlers === true;

  const api = new Proxy(
    {
      config: options.config ?? {},
      logger: options.logger ?? console,
      pluginConfig: options.pluginConfig ?? {},
      runtime: options.runtime ?? {},
      on(name, handler) {
        const captureIndex =
          captured.push({
            kind: "hook",
            name,
            handlerType: typeof handler,
            arguments: summarizeArguments([name, handler]),
          }) - 1;
        if (retainHandlers) {
          retained.push({
            kind: "hook",
            name,
            handler,
            captureIndex,
          });
        }
        return api;
      },
    },
    {
      get(target, property) {
        if (property === "getCapturedContracts") {
          return () => captured.map((entry) => ({ ...entry }));
        }
        if (property === "getRetainedContracts") {
          return () => retained.map((entry) => ({ ...entry }));
        }
        if (property in target) {
          return target[property];
        }
        if (typeof property === "string" && isRegistrarProperty(property)) {
          return (...args) => {
            const captureIndex =
              captured.push({
                kind: "registration",
                name: property,
                known: knownRegistrars.size === 0 ? null : knownRegistrars.has(property),
                arguments: summarizeArguments(args),
              }) - 1;
            if (retainHandlers) {
              retained.push({
                kind: "registration",
                name: property,
                arguments: args,
                captureIndex,
              });
            }
            return registrationReturnValue(property, args);
          };
        }
        return undefined;
      },
    },
  );

  return api;
}

function isRegistrarProperty(property) {
  return property.startsWith("register") || property.startsWith("define");
}

function registrationReturnValue(name, args) {
  if (name === "registerService") {
    return {
      name: objectName(args[0]),
      start: async () => undefined,
      stop: async () => undefined,
    };
  }
  return objectName(args[0]) ?? undefined;
}

function summarizeArguments(args) {
  return args.map((arg) => summarizeValue(arg));
}

function summarizeValue(value) {
  if (typeof value === "function") {
    return { type: "function" };
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value).sort(),
      name: objectName(value),
    };
  }
  return { type: typeof value, value };
}

function objectName(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof value.name === "string") {
    return value.name;
  }
  return typeof value.id === "string" ? value.id : null;
}
