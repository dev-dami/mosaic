// The person's model profiles, kept by the runtime's byok.js (localStorage, plain text in this
// browser only). On localhost byok.js also mirrors the whole store, keys included, into a Path=/
// cookie (byok.js canUseByokCookie / writeCookieStore). Cookies are not port-scoped, so every local
// demo site would receive the key in its Cookie header. Every call here clears that cookie before
// and after byok.js runs: the write and the clear happen in one synchronous task, so no request can
// carry the cookie in between, and a cookie planted by another local port is never read.
import type { ModelSetup } from "../agentic/engine";

export const RUNTIME_BYOK_URL = "/runtime/byok.js";
/** byok.js COOKIE_NAME. test/engine.test.ts checks it against the pinned runtime. */
export const BYOK_COOKIE = "nsweb_byok_profiles_v1";

export interface ByokProfile {
  id: string;
  name: string;
  key: string;
  model: string;
  router: string;
  updatedAt: string;
}
export interface ByokStore {
  selectedId: string;
  profiles: ByokProfile[];
}

interface ByokModule {
  loadByokStore(): ByokStore;
  getSelectedByokProfile(store?: ByokStore): ByokProfile | null;
  upsertByokProfile(profile: Partial<ByokProfile>, opts?: { select?: boolean }): { store: ByokStore; profile: ByokProfile | null };
  deleteByokProfile(id: string): ByokStore;
  selectByokProfile(id: string): ByokStore;
  loadTabByokSetup(saved?: ByokProfile | null): ModelSetup;
}

export function clearByokCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${BYOK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function guarded<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args) => {
    clearByokCookie();
    try {
      return fn(...args);
    } finally {
      clearByokCookie();
    }
  };
}

export interface ProfileStore {
  load(): ByokStore;
  save(profile: Partial<ByokProfile>): ByokStore;
  select(id: string): ByokStore;
  remove(id: string): ByokStore;
  /** The setup a new engine should use: the selected profile, or no key. */
  setup(): ModelSetup;
}

let loading: Promise<ProfileStore> | null = null;

/** Loads byok.js from the runtime and wraps its store functions with the cookie guard. */
export function loadProfileStore(url: string = RUNTIME_BYOK_URL): Promise<ProfileStore> {
  loading ??= (import(/* @vite-ignore */ url) as Promise<ByokModule>).then((byok) => {
    clearByokCookie();
    return {
      load: guarded(() => byok.loadByokStore()),
      save: guarded((profile: Partial<ByokProfile>) => byok.upsertByokProfile(profile, { select: true }).store),
      select: guarded((id: string) => byok.selectByokProfile(id)),
      remove: guarded((id: string) => byok.deleteByokProfile(id)),
      setup: guarded(() => {
        const s = byok.loadTabByokSetup(byok.getSelectedByokProfile(byok.loadByokStore()));
        return { key: s.key || "", router: s.router || "", model: s.model || "" };
      }),
    };
  });
  return loading;
}
