/**
 * AuthContext — single source of truth for the current user's identity,
 * role, permissions, and menu. Rendered near the top of the app so every
 * page can read it via useAuth().
 *
 * Backend authority: the shape here mirrors GET /api/auth/me/ verbatim.
 * Never hard-code role-to-page mappings elsewhere; always read from `menu`.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACCESS_TOKEN_KEY,
  clearAuthStorage,
  readAccessToken,
} from "../api/client";
import { AuthProfile, fetchMe } from "../api/auth";

type AuthState = {
  profile: AuthProfile | null;
  loading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  reload: () => Promise<void>;
  logout: () => void;
  hasPermission: (codename: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<AuthState>({
    profile: null,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    const token = readAccessToken();
    tokenRef.current = token;
    if (!token) {
      setState({ profile: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const profile = await fetchMe();
      setState({ profile, loading: false, error: null });
    } catch (err) {
      setState({
        profile: null,
        loading: false,
        error: (err as Error).message ?? "Failed to load profile",
      });
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthStorage();
    tokenRef.current = null;
    setState({ profile: null, loading: false, error: null });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const syncIfTokenChanged = () => {
      const token = readAccessToken();
      if (token !== tokenRef.current) {
        void reload();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_KEY || event.key === null) {
        syncIfTokenChanged();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncIfTokenChanged);
    document.addEventListener("visibilitychange", syncIfTokenChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncIfTokenChanged);
      document.removeEventListener("visibilitychange", syncIfTokenChanged);
    };
  }, [reload]);

  const value = useMemo<AuthContextValue>(
    () => {
      const profile = state.profile;
      const rawPermissions = profile?.permissions;
      const permissions = Array.isArray(rawPermissions) ? rawPermissions : [];
      return {
        ...state,
        reload,
        logout,
        hasPermission: (codename: string) => permissions.includes(codename),
      };
    },
    [state, reload, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
