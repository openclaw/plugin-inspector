export const defaultCaptureApiRegistrarProfiles = {
  registerChannel: {
    returnValue: ({ args }) => registrationObject(args, { id: "channel" }),
  },
  registerCli: {
    returnValue: ({ args }) => registrationObject(args, { name: "cli" }),
  },
  registerCommand: {
    returnValue: ({ args }) => registrationObject(args, { name: "command" }),
  },
  registerContextEngine: {
    returnValue: ({ args }) => registrationObject(args, { id: "context-engine" }),
  },
  registerGatewayMethod: {
    returnValue: ({ args }) => registrationObject(args, { name: "gateway.method" }),
  },
  registerHook: {
    returnValue: ({ api }) => api,
  },
  registerHttpRoute: {
    returnValue: ({ args }) => ({
      ...registrationObject(args, { method: "GET", path: "/" }),
      unregister() {},
    }),
  },
  registerInteractiveHandler: {
    returnValue: ({ args }) => registrationObject(args, { id: "interactive-handler" }),
  },
  registerMemoryPromptSection: {
    returnValue: ({ args }) => registrationObject(args, { id: "memory-prompt-section" }),
  },
  registerMemoryRuntime: {
    returnValue: ({ args }) => registrationObject(args, { id: "memory-runtime" }),
  },
  registerProvider: {
    returnValue: ({ args }) => registrationObject(args, { id: "provider" }),
  },
  registerService: {
    returnValue: ({ args }) => ({
      ...registrationObject(args, { name: "service" }),
      start: async () => undefined,
      stop: async () => undefined,
    }),
  },
  registerSpeechProvider: {
    returnValue: ({ args }) => registrationObject(args, { id: "speech-provider" }),
  },
  registerTool: {
    returnValue: ({ args }) => registrationObject(args, { name: "tool" }),
  },
};

export function createCaptureApi(options = {}) {
  const captured = [];
  const retained = [];
  const registrarProfiles = {
    ...defaultCaptureApiRegistrarProfiles,
    ...(options.registrarProfiles ?? {}),
  };
  const knownRegistrars = new Set(options.knownRegistrars ?? Object.keys(registrarProfiles));
  const retainHandlers = options.retainHandlers === true;

  const api = new Proxy(
    {
      ...createCaptureContext(options),
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
            return registrationReturnValue(property, args, { api, registrarProfiles });
          };
        }
        return undefined;
      },
    },
  );

  return api;
}

export function createCaptureContext(options = {}) {
  return {
    config: options.config ?? {},
    logger: options.logger ?? console,
    pluginConfig: options.pluginConfig ?? {},
    runtime: options.runtime ?? createRuntimeContext(options),
    secrets: options.secrets ?? createSecretContext(options),
    store: options.store ?? createStoreContext(options),
    paths: options.paths ?? {
      cacheDir: ".plugin-inspector/cache",
      configDir: ".plugin-inspector/config",
      dataDir: ".plugin-inspector/data",
    },
    agent: options.agent ?? {
      id: "plugin-inspector-agent",
      accountId: "default",
    },
    gateway: options.gateway ?? {
      baseUrl: "http://127.0.0.1:0",
      registerRoute(route) {
        return {
          ...route,
          unregister() {},
        };
      },
    },
    fetch: options.fetch ?? (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })),
  };
}

function isRegistrarProperty(property) {
  return property.startsWith("register") || property.startsWith("define");
}

function registrationReturnValue(name, args, context) {
  const profile = context.registrarProfiles[name];
  if (profile?.returnValue) {
    return profile.returnValue({ name, args, api: context.api });
  }
  return registrationObject(args, {});
}

function createRuntimeContext(options) {
  return {
    env: options.env ?? {},
    logger: options.logger ?? console,
    now: () => new Date(0),
  };
}

function createSecretContext(options) {
  const secrets = new Map(Object.entries(options.secretValues ?? {}));
  return {
    async get(name) {
      return secrets.get(name) ?? null;
    },
    async has(name) {
      return secrets.has(name);
    },
    async require(name) {
      if (!secrets.has(name)) {
        throw new Error(`Missing mocked secret: ${name}`);
      }
      return secrets.get(name);
    },
    async resolve(value) {
      return typeof value === "string" && value.startsWith("secret:") ? (secrets.get(value.slice(7)) ?? null) : value;
    },
  };
}

function createStoreContext() {
  const values = new Map();
  return {
    async delete(key) {
      return values.delete(key);
    },
    async get(key) {
      return values.get(key);
    },
    async list() {
      return [...values.keys()].sort();
    },
    async set(key, value) {
      values.set(key, value);
      return value;
    },
  };
}

function registrationObject(args, defaults) {
  const first = args[0];
  if (first && typeof first === "object") {
    return {
      ...defaults,
      ...first,
      name: objectName(first) ?? defaults.name,
      id: objectId(first) ?? defaults.id,
    };
  }
  if (typeof first === "string") {
    return {
      ...defaults,
      name: first,
      id: defaults.id,
    };
  }
  return { ...defaults };
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

function objectId(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof value.id === "string") {
    return value.id;
  }
  return typeof value.name === "string" ? value.name : null;
}
