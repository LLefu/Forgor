import type { Plugin } from "../types";

/** Both are needed: search by meaning made the difference between finding 25 and 31 of 31 sources in testing. */
export const CHAT_MODELS: NonNullable<Plugin["models"]> = [
  { id: "language", for: "writing the answers" },
  { id: "search", for: "finding what you mean, also in other words or another language" },
];
