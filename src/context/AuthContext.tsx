"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { UserProfile } from "@/lib/schemas";
interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: boolean;
}
interface AuthContextType extends AuthState {
  refreshProfile: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  profileError: false,
  refreshProfile: async () => {},
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
    profileError: false,
  });
  const version = useRef(0);
  const load = useCallback(async (user: User | null) => {
    const request = ++version.current;
    setState({ user, profile: null, loading: !!user, profileError: false });
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok && response.status !== 404)
        throw new Error("profileError");
      const profile = response.ok
        ? ((await response.json()) as UserProfile)
        : null;
      if (request === version.current && auth.currentUser?.uid === user.uid)
        setState({ user, profile, loading: false, profileError: false });
    } catch {
      if (request === version.current)
        setState({ user, profile: null, loading: false, profileError: true });
    }
  }, []);
  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (active) void load(user);
    });
    const counter = version;
    return () => {
      active = false;
      ++counter.current;
      unsubscribe();
    };
  }, [load]);
  const refreshProfile = useCallback(() => load(auth.currentUser), [load]);
  return (
    <AuthContext.Provider value={{ ...state, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
