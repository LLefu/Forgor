import { isTauri } from "./env";

/**
 * Plugins signing in to a web service (Rust: src-tauri/src/oauth.rs): OAuth 2
 * with PKCE in the system browser. Refresh tokens stay in the keychain, in
 * Rust; this side only ever sees short-lived access tokens. The browser build
 * signs in at once with fake tokens.
 */
export interface OAuthProvider {
  clientId: string;
  /** Only where the provider wants one for desktop apps (Google); it isn't secret there. */
  clientSecret?: string;
  /** The provider's sign-in page, e.g. https://accounts.google.com/o/oauth2/v2/auth */
  authUrl: string;
  /** Where codes become tokens, e.g. https://oauth2.googleapis.com/token */
  tokenUrl: string;
  scopes: string[];
  /** Extra parameters for the sign-in page: { access_type: "offline", prompt: "consent" } for a Google refresh token. */
  authParams?: Record<string, string>;
}

export interface AccessToken {
  accessToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  scope: string | null;
}

export interface OAuth {
  token(plugin: string, provider: OAuthProvider, interactive: boolean): Promise<AccessToken | null>;
  cancel(): Promise<void>;
  signOut(plugin: string, provider: OAuthProvider): Promise<void>;
}

let backend: OAuth | null = null;

export function oauth(): OAuth {
  backend ??= isTauri() ? tauriOAuth() : fakeOAuth();
  return backend;
}

function tauriOAuth(): OAuth {
  const invoke = async <T>(cmd: string, args: Record<string, unknown> = {}) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  return {
    token: (plugin, provider, interactive) => invoke("oauth_token", { plugin, provider, interactive }),
    cancel: () => invoke("oauth_cancel"),
    signOut: (plugin, provider) => invoke("oauth_sign_out", { plugin, provider }),
  };
}

const providerKey = (plugin: string, p: OAuthProvider) => `${plugin}|${p.clientId}|${p.tokenUrl}|${[...p.scopes].sort().join(" ")}`;

/** For the browser build and e2e: signing in succeeds at once (`refuse` makes the next one fail). */
export const fakeOAuthState = { signedIn: new Set<string>(), signIns: 0, refuse: false };

function fakeOAuth(): OAuth {
  return {
    token: async (plugin, provider, interactive) => {
      const key = providerKey(plugin, provider);
      if (!fakeOAuthState.signedIn.has(key)) {
        if (!interactive) return null;
        if (fakeOAuthState.refuse) {
          fakeOAuthState.refuse = false;
          throw new Error("Sign-in was cancelled");
        }
        fakeOAuthState.signIns++;
        fakeOAuthState.signedIn.add(key);
      }
      return { accessToken: `fake-token-${plugin}`, expiresAt: Date.now() + 3600_000, scope: provider.scopes.join(" ") };
    },
    cancel: async () => {},
    signOut: async (plugin, provider) => void fakeOAuthState.signedIn.delete(providerKey(plugin, provider)),
  };
}
