# Independent SDK source benchmark

This answer key covers all 69 canonical core-bundled OpenClaw plugins at the commit in `contract.json`. The inventory was exported from OpenClaw’s canonical plugin inventory generator, before detector work. `roster.json` preserves population identity; `audit-progress.json` records each uniquely dispatched auditor and completion status.

The contract is frozen before dispatch. Each auditor manually reviews its plugin’s production source and relevant SDK contracts without seeing Inspector implementation or output. Navigation, complete file enumeration, and file hashing may be scripted; expectation extraction may not. Each plugin has one owner and records evidence, reviewed/excluded files, genuine unknowns and source identity.

This is a **source-phase** benchmark. Type imports and other syntax erased from JavaScript remain dependencies here. Packaged-artifact expectations require a separate package-file audit; the source findings are not automatically package findings. SDK imports are syntactic dependencies, not telemetry or claims that the imported function executes.

Canonical examples:

- `sdk-module:openclaw/plugin-sdk/core`
- `sdk-export:openclaw/plugin-sdk/core#OpenClawPluginApi` (original export, even if locally aliased)
- `api-member:api.registerTool`
- `runtime-member:runtime.channel.reply.dispatchReplyFromConfig`
- `hook:hook.before_agent_start`
- `manifest-contract:manifest.contracts.tools:example_tool`

API/runtime access records the maximal member path at an occurrence. Longer access does not invent all prefixes. `api.runtime` and equivalent runtime-store handles normalize to `runtime`. Registration methods share `api-member`; named hooks additionally record their declared hook identity. Imported module and named export identities intentionally answer different inventory questions.

All exclusions use file-scope rules from `contract.json`; production imports override directory-name exclusions. Package metadata and manifests are reviewed separately. Ambiguous ownership or dynamically computed access is documented, never silently guessed.

## Source-backed clarifications

- Browser audit: `createPluginRuntimeStore<BrowserStateRuntime>` stores a plugin-owned structure. The helper name alone does not make every stored member an SDK runtime member. Only its `gateway` field, proven as `PluginRuntime["gateway"]` and copied from `api.runtime`, maps to `runtime.gateway.*`. Plugin-owned `sessionTabs`, `dashboardOperations`, and other custom fields stay outside runtime-member findings. This applies the frozen contract’s provenance/no-lookalikes rule; it does not broaden the source population.

- Telegram audit: `TelegramRuntime` extends the public runtime with optional `channel.telegram` transport functions typed from plugin-local modules. Those augmentations are not members of the public `PluginRuntimeChannel`; inherited public runtime members remain eligible. Likewise, the plugin-owned `TelegramBotDeps` object aliases SDK free functions without becoming a runtime handle.

- Classification clarification (approved before broad dispatch): classify **source syntax**, not hypothetical emitted JavaScript. Ordinary value imports/reexports and dynamic imports count as runtime dependencies even if unused or removed by build settings. Explicit `import type` / `export type`, inline type specifiers, and references in type syntax count as type dependencies. All references in `.d.ts`, `.d.mts`, and `.d.cts` declaration-file contexts are type-only. An identity observed in both source categories is `mixed`. Manifest records are `declarative`. The Alibaba/SGLang pilot imports are ordinary value imports used in runtime calls and remain consistently `runtime`.

- Public member type dependencies count: a direct indexed access such as `PluginRuntime["channel"]["reply"]` contributes `runtime-member:runtime.channel.reply` classified `type`, alongside the imported `PluginRuntime` SDK export. The equivalent rule applies to `OpenClawPluginApi` indexed members. Record only the maximal indexed path at an occurrence. These records identify type consumers without claiming runtime execution.

- Bare runtime handles: propagation such as passing `api.runtime` into a plugin-owned helper is traced to its concrete consumed members. Do not add a separate `runtime` root identity or duplicate `api.runtime` prefix. If a handle escapes into an opaque non-SDK dependency and member consumption cannot be resolved, record the escape as an evidenced unknown. Known SDK helper calls retain their SDK-export dependency without inferring internal member consumption.
- A runtime value import plus explicit type usage (for example `Parameters<typeof errorShape>`) makes that SDK-export identity `mixed` with type-reference evidence. The SDK-module classification follows module import/export/type-query sites; later type use of an imported symbol does not itself create a new module import site.

- Direct `typeof` of an SDK symbol or proven direct alias contributes a type reference. `typeof` of a plugin-owned composite object (Telegram's `telegramBotImplementations` is an example) does not expand every inferred property into transitive SDK references. An explicit property/index narrowing that identifies an SDK symbol does contribute.

- Proven built-in `Pick<T, literal key(s)>` explicitly selects public member paths. Browser's `Pick<PluginRuntime["state"], "openKeyedStore">` contributes `runtime.state.openKeyedStore` as a type reference (mixed when also called), and does not separately contribute its `runtime.state` prefix unless independently used elsewhere. Broad `Omit` and inferred composite types are not expanded into every possible remaining member. This source-backed correction was identified during coordinator review of the independently authored Browser fixture.

- Namespace import clarification: preserve `*` as the syntactically imported namespace export and additionally record separately observed named export/member references whose provenance is resolved. Narrowing later usage does not remove the original namespace-import dependency. For static `import * as sdk`, the `import` kind belongs to `*`; named exports selected later receive their actual call/member-access/type-reference kinds without a synthetic named-import site. Direct dynamic imports separately retain the resolved named-export dynamic-import provenance described below.

- **Reference-kind completeness:** each finding's `referenceKinds` is the exact set established by source occurrences, even when a new kind does not change classification. A proven SDK function call adds `call`; an annotation using an imported SDK type adds `type-reference`. Evidence may be representative per kind, but choosing a smaller evidence sample never narrows the required kind set. Imports/reexports are separate source sites. Use the most-specific kind at an occurrence: `api.registerTool()` contributes `call`, while a distinct non-call property read contributes `member-access`; include both only when distinct occurrences establish both. Apply the same rule to runtime and SDK namespace members. This requirement prompted original-owner reconciliation of the early fixtures before the final freeze.

- References rooted directly in imported SDK exports: calling an exported object's member (for example `theme.heading()`) or constructing an exported class contributes `call` to that exported-root identity, with evidence explaining the actual operation. Non-call object member reads contribute `member-access`. Bare value passing has no additional reference kind beyond its dependency site. Do not extend this treatment to arbitrary members of SDK function return values.

- A non-call local property selection whose value is proven to be an SDK export (for example `telegramDeps.sdkFn`) contributes `member-access` to that export identity. Explain the plugin-owned alias container in evidence; do not invent a public API/runtime path for it. A bare identifier fallback adds no extra kind. Explicit `super(...)` whose base resolves to an imported SDK constructor contributes `call` to that constructor export; a mere `extends` clause does not invent a call.

- Literal `Pick` also narrows plugin-owned alias containers: `Pick<typeof telegramBotImplementations, "getRuntimeConfig" | ...>` contributes type references only to the explicitly selected properties whose values are proven SDK exports. It does not expand other composite members or create public paths for the local container.

- Proven local-barrel import/reexport sites contribute their syntactic `import`, `type-import`, `reexport`, or `type-reexport` kinds and source classifications to the original SDK-export identity, including unused imports. They do not add SDK-module dependency sites; those require the SDK module specifier itself. Preserve namespace/star and separately resolved named symbols under the same rule.

- Report coverage maps `filesAnalyzed` to reviewed source plus reviewed package/manifest metadata, and `filesExcluded` to excluded records. A complete traversal has `filesDiscovered = filesAnalyzed + filesExcluded`. Unknown references remain analyzed. A failed/partial traversal may leave discovered greater than analyzed plus excluded, never less.

- Resolved named SDK exports later selected through a dynamic local-barrel import gain `dynamic-import` on their original SDK-export identities. A local composite namespace does not create a synthetic SDK `*` export or an extra SDK-module site. Whole local `typeof import()` remains unexpanded unless narrowed to a proven SDK-valued property.

- A forwarding wrapper such as `opts => api.runtime.state.openKeyedStore(opts)` is a plugin-owned function. Its body contributes the actual public-member call; calls or selections of the wrapper do not acquire SDK reference kinds/evidence. Direct callable aliases (for example assigning `api.lifecycle.runInBackgroundContext` unchanged) preserve SDK provenance. Do not infer transitive calls through a wrapper's identity.

- Declaration-style aliases preserve provenance without inventing specifier syntax: `export const local = sdkValue` is not a `reexport` site; `export type Local = SdkType` records the RHS type reference but is not a `type-reexport` specifier. Explicit export specifiers retain their reexport kinds. This follows the source-syntax rule and was reconciled by the Memory Core owner.

- A downstream annotation using a plugin-owned projected type does not re-enumerate its inferred SDK members. The explicit `Pick` or indexed-access definition supplies the selected public-member type evidence; subsequent use of the whole local object type adds no transitive member evidence. Direct aliases of an SDK symbol still preserve that symbol’s provenance.

- Anthropic’s `createLazyRuntimeMethod(createLazyRuntimeModule(() => import(SDK_MODULE)), runtime => runtime.namedExport)` preserves the direct dynamic-import module and namespace `*`, plus the resolved named export and its selector member-access. Calling the helper-produced wrapper does not add a call to the original export: it is not a direct unchanged callable alias. This applies the existing SDK-helper boundary without inferring helper internals.

- Destructuring a proven SDK-valued property from a plugin-owned context/container is a non-call `member-access` site on the original SDK export, equivalent to `context.helper`. Later unchanged-alias invocation adds `call`; the local container does not acquire an API/runtime path. Import/require binding syntax retains its existing import-form kind rather than acquiring this local-container member-access kind. XAI’s capability metadata contexts prompted this explicit wording; earlier OpenAI, Telegram and Memory Core audits already record equivalent destructuring evidence.

- Direct immediately narrowed dynamic imports, including `import(SDK_MODULE).then(({ namedExport }) => ...)`, record the module and named export with `dynamic-import`. The import binding itself adds neither a synthetic `*` nor `member-access`; later direct calls/selections retain their actual kinds. This differs from retaining a whole module namespace in a lazy loader.

- Public API/runtime paths stop before standard JavaScript built-in behavior. For example, `api.config.gateway.controlUi.basePath.trim()` reads the public string field `api.config.gateway.controlUi.basePath` (`member-access`); `String.prototype.trim` is not an SDK method. The same boundary applies to standard array/string/object methods on public data values. This does not remove real SDK-defined callable members. MCP Relay's source and the public string-typed `basePath` schema establish this distinction.

- An SDK function injected through a context can have equivalent exports from several facades. Exact `typeof` declarations plus unchanged host assignment establish function provenance; use the documented focused facade for this implicit dependency, without inventing an import site or dependencies on every equivalent facade. At the pin, `docs/plugins/sdk-migration/how-to-migrate.md:1525` maps `formatErrorMessage` to `error-runtime`, and `docs/plugins/sdk-subpaths.md:551` directs provider implementations to `realtime-transcription-session`. ElevenLabs' original auditor independently reconciled these identities before the freeze. Explicit plugin imports continue to retain their actual module specifiers. This convention does not claim that a context consumer imports the chosen facade.

## Final freeze gate

`freeze.json` is created only after all 69 distinct original auditors finish and every fixture passes source/evidence/coverage validation. It records schema version 1, status `frozen`, the common source identity, core population count, byte SHA256 hashes of `contract.json`, this README, `roster.json`, `audit-progress.json`, and each fixture, plus original auditor identities and per-fixture/aggregate counts. The progress ledger is frozen with every plugin `validated`.

A comparison runner must refuse candidate comparisons before this freeze, verify the exact roster and hashes, require distinct independent auditor identities, and validate source evidence. Compare canonical identities, classifications and complete reference-kind sets; evidence samples need not have identical cardinality. Reviewed and excluded files partition coverage. Documented genuine unknowns remain explicit and are not silently converted to empty findings. Semantic corrections require original-owner source reconciliation; byte changes require regenerating the freeze record.

- Source-only reconciliation (Active Memory and Anthropic): passing an API/config value unchanged through a local parameter preserves its origin even if the parameter is annotated `unknown`, narrowed by guards, cast, or selected alongside a fallback in a conditional. Record statically proven accesses on the original-object branch as possible dependencies; do not claim that branch executed. Fresh/transformed object results and arbitrary SDK helper return values do not inherit the input object's identity. This clarifies the existing alias rule and adds previously omitted source references; the original auditors independently enumerated and evidenced each correction.
