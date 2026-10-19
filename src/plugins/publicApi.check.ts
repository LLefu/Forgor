/**
 * Type-check only (nothing imports this file): the public plugin API types in
 * packages/plugin-api/index.d.ts must keep matching what the app really gives
 * plugins and accepts from them. A change here that breaks plugins fails
 * `npm run typecheck`: update the public types (and say so in the CHANGELOG).
 */
import type * as Public from "../../packages/plugin-api";
import type { createPluginApi, PluginDefinition, PluginManifest } from "./api";

type Assert<T extends true> = T;

/** The app's api object works as the public PluginApi. */
export type ApiMatches = Assert<ReturnType<typeof createPluginApi> extends Public.PluginApi ? true : false>;
/** What a plugin returns (public) is something the app accepts. */
export type DefinitionMatches = Assert<Public.PluginDefinition extends PluginDefinition ? true : false>;
/** A public manifest is one the app reads. */
export type ManifestMatches = Assert<Public.PluginManifest extends PluginManifest ? true : false>;
