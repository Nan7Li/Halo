import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api";

export interface AuthUser {
  username: string;
  role: string;
}

interface AuthContextValue {
  ready: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** The profile photo as a data URL, or "" for the monogram. */
  avatar: string;
  setAvatar: (image: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [avatar, setAvatarState] = useState("");

  useEffect(() => {
    if (!user) {
      setAvatarState("");
      return;
    }
    let cancelled = false;
    api
      .api<{ image: string }>("/settings/avatar")
      .then((result) => {
        if (!cancelled) setAvatarState(result?.image || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setAvatar = useCallback(async (image: string) => {
    const result = image
      ? await api.api<{ image: string }>("/settings/avatar", { method: "PUT", body: { image } })
      : await api.api<{ image: string }>("/settings/avatar", { method: "DELETE" });
    setAvatarState(result?.image || "");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await api.session();
      setUser(current.authenticated ? { username: current.username, role: current.role } : null);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        await api.login(username, password);
        const current = await api.session();
        setUser({ username: current.username || username, role: current.role || "Administrator" });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const unauthorized = () => {
      setUser(null);
      setReady(true);
    };
    window.addEventListener("vocat:unauthorized", unauthorized);
    return () => window.removeEventListener("vocat:unauthorized", unauthorized);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, isAuthenticated: !!user, user, login, logout, refresh, avatar, setAvatar }),
    [ready, user, login, logout, refresh, avatar, setAvatar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
