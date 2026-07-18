export const defaultCaptureApiRegistrarProfiles = {
  registerChannel: {
    returnValue: ({ args }) => channelRegistrationObject(args),
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
    returnValue: ({ args }) => gatewayMethodRegistrationObject(args),
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
      ...registrationObject(args, { id: "service", name: "service" }),
      start: async () => undefined,
      stop: async () => undefined,
      dispose: async () => undefined,
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
      onConversationBindingResolved(handler) {
        const captureIndex =
          captured.push({
            kind: "hook",
            name: "onConversationBindingResolved",
            handlerType: typeof handler,
            arguments: summarizeArguments([handler]),
          }) - 1;
        if (retainHandlers) {
          retained.push({
            kind: "hook",
            name: "onConversationBindingResolved",
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
            const returnValue = registrationReturnValue(property, args, { api, registrarProfiles });
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
                returnValue,
                captureIndex,
              });
            }
            return returnValue;
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
    registrationMode: options.registrationMode ?? "full",
    config: options.config ?? {},
    logger: options.logger ?? console,
    pluginConfig: options.pluginConfig ?? {},
    resolvePath: options.resolvePath ?? ((value) => value),
    runtime: options.runtime ?? createRuntimeContext(options),
    secrets: options.secrets ?? createSecretContext(options),
    store: options.store ?? createStoreContext(),
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
      async call(method, params) {
        return { ok: true, method, params };
      },
      respond(ok, result, error) {
        return { ok, result, ...(error ? { error } : {}) };
      },
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
  const runtime = options.runtime ?? {};
  const blobStores = new Map();
  const syncKeyedStores = new Map();
  return {
    ...runtime,
    agent: runtime.agent ?? {},
    env: options.env ?? {},
    logger: options.logger ?? console,
    now: () => new Date(0),
    tts: runtime.tts ?? {},
    state: {
      resolveStateDir: () => options.stateDir ?? process.cwd(),
      openBlobStore(storeOptions) {
        const existing = blobStores.get(storeOptions.namespace);
        if (existing) {
          return existing;
        }
        const store = createBlobStoreContext(storeOptions);
        blobStores.set(storeOptions.namespace, store);
        return store;
      },
      openSyncKeyedStore({ namespace }) {
        const existing = syncKeyedStores.get(namespace);
        if (existing) {
          return existing;
        }
        const store = createSyncKeyedStoreContext();
        syncKeyedStores.set(namespace, store);
        return store;
      },
      ...(runtime.state ?? {}),
    },
  };
}

function createBlobStoreContext(options) {
  const values = new Map();
  const entryInfo = (key, entry) => ({
    key,
    metadata: entry.metadata,
    sizeBytes: entry.bytes.byteLength,
    createdAt: entry.createdAt,
    ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt }),
  });
  const read = (key) => {
    const entry = values.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return { ...entryInfo(key, entry), bytes: Uint8Array.from(entry.bytes) };
  };
  const register = async (key, bytes, metadata, registerOptions) => {
    const createdAt = Date.now();
    const ttlMs = registerOptions?.ttlMs ?? options.defaultTtlMs;
    values.set(key, {
      bytes: Uint8Array.from(bytes),
      metadata,
      createdAt,
      ...(ttlMs === undefined ? {} : { expiresAt: createdAt + ttlMs }),
    });
  };
  return {
    register,
    async registerIfAbsent(key, bytes, metadata, registerOptions) {
      if (values.has(key)) {
        return false;
      }
      await register(key, bytes, metadata, registerOptions);
      return true;
    },
    async lookup(key) {
      return read(key);
    },
    async entries() {
      return [...values.keys()].flatMap((key) => {
        const entry = read(key);
        if (!entry) {
          return [];
        }
        const { bytes: _bytes, ...info } = entry;
        return [info];
      });
    },
    async delete(key) {
      return values.delete(key);
    },
    async deleteExpiredKey(key) {
      const entry = values.get(key);
      if (!entry || entry.expiresAt === undefined || entry.expiresAt > Date.now()) {
        return undefined;
      }
      values.delete(key);
      return entryInfo(key, entry);
    },
    async deleteExpired() {
      const expired = [];
      for (const [key, entry] of values) {
        if (entry.expiresAt === undefined || entry.expiresAt > Date.now()) {
          continue;
        }
        values.delete(key);
        expired.push(entryInfo(key, entry));
      }
      return expired;
    },
    async clear() {
      values.clear();
    },
  };
}

function createSyncKeyedStoreContext() {
  const values = new Map();
  return {
    register(key, value) {
      values.set(key, value);
    },
    registerIfAbsent(key, value) {
      if (values.has(key)) {
        return false;
      }
      values.set(key, value);
      return true;
    },
    update(key, updateValue) {
      const next = updateValue(values.get(key));
      if (next === undefined) {
        return false;
      }
      values.set(key, next);
      return true;
    },
    lookup(key) {
      return values.get(key);
    },
    consume(key) {
      const value = values.get(key);
      values.delete(key);
      return value;
    },
    delete(key) {
      return values.delete(key);
    },
    entries() {
      return [...values].map(([key, value]) => ({ key, value, createdAt: 0 }));
    },
    clear() {
      values.clear();
    },
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
  const callable = firstCallable(args);
  if (first && typeof first === "object") {
    return {
      ...defaults,
      ...first,
      name: objectName(first) ?? defaults.name,
      id: objectId(first) ?? defaults.id,
    };
  }
  if (typeof first === "string") {
    return withCallableDefaults({
      ...defaults,
      name: first,
      id: defaults.id,
    }, callable);
  }
  return withCallableDefaults({ ...defaults }, callable);
}

function channelRegistrationObject(args) {
  const first = args[0];
  const registration = registrationObject(args, { id: "channel" });
  if (first?.plugin && typeof first.plugin === "object") {
    return {
      ...registration,
      id: objectId(first.plugin) ?? registration.id,
      plugin: first.plugin,
    };
  }
  return registration;
}

function gatewayMethodRegistrationObject(args) {
  const [method, handler, options] = args;
  const registration = registrationObject(args, { name: "gateway.method" });
  if (typeof method !== "string") {
    return registration;
  }
  return {
    ...registration,
    name: method,
    method,
    handler: typeof handler === "function" ? handler : registration.handler,
    run: typeof handler === "function" ? handler : registration.run,
    execute: typeof handler === "function" ? handler : registration.execute,
    scope: options?.scope ?? registration.scope,
  };
}

function firstCallable(args) {
  return args.find((arg) => typeof arg === "function");
}

function withCallableDefaults(value, callable) {
  if (!callable) {
    return value;
  }
  return {
    ...value,
    handler: typeof value.handler === "function" ? value.handler : callable,
    run: typeof value.run === "function" ? value.run : callable,
    execute: typeof value.execute === "function" ? value.execute : callable,
  };
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
