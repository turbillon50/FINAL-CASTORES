import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useClerk } from "@clerk/react";

export type UserRole = "admin" | "supervisor" | "client" | "worker" | "proveedor";

export interface AppUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  company: string;
  avatarUrl: string | null;
  isActive: boolean;
  isRealUser?: boolean;
}

const REAL_USER_KEY = "castores_real_user";

function loadUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(REAL_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppUser;
  } catch {
    return null;
  }
}

interface AuthContextType {
  user: AppUser | null;
  isLoading: boolean;
  setRealUser: (user: AppUser) => void;
  clearDemoUser: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AppUser | null>(loadUser);
  const { signOut: clerkSignOut } = useClerk();

  const setRealUser = (u: AppUser) => {
    const real = { ...u, isRealUser: true };
    localStorage.setItem(REAL_USER_KEY, JSON.stringify(real));
    setUserState(real);
  };

  const clearDemoUser = useCallback(() => {
    localStorage.removeItem(REAL_USER_KEY);
    setUserState(null);
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(REAL_USER_KEY);
    localStorage.removeItem("castores_invite_code");
    localStorage.removeItem("castores_signup_step");
    localStorage.removeItem("castores_signup_email");
    sessionStorage.setItem("castores_signed_out", "1");
    setUserState(null);
    try {
      await clerkSignOut();
    } catch {
      // Non-fatal: proceed to login even if Clerk sign-out fails
    }
    window.location.href = `${import.meta.env.BASE_URL}`;
  }, [clerkSignOut]);

  return (
    <AuthContext.Provider value={{ user, isLoading: false, setRealUser, clearDemoUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Keep DemoUser as a type alias for backward compatibility with components
// that still reference it. It is identical to AppUser.
export type DemoUser = AppUser;
