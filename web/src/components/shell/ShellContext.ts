import { createContext, useContext } from "react";
import type { NavItem } from "./nav";

export interface ShellState {
  developer: boolean;
  extensions: NavItem[];
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Sets the badge count shown on a tab or sidebar item (0 hides it). */
  setBadge: (path: string, count: number) => void;
}

export const ShellContext = createContext<ShellState>({
  developer: false,
  extensions: [],
  isDark: false,
  onToggleTheme: () => undefined,
  onLogout: () => undefined,
  setBadge: () => undefined,
});

export function useShell() {
  return useContext(ShellContext);
}
