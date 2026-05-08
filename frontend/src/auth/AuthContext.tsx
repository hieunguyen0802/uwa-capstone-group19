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
  useState,
} from "react";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
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
  const [state, setState] = useState<AuthState>({
    profile: null,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
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
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setState({ profile: null, loading: false, error: null });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      reload,
      logout,
      hasPermission: (codename: string) =>
        state.profile?.permissions.includes(codename) ?? false,
    }),
    [state, reload, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
