import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import authService from '../services/authService';
import { ROLES } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authService.getStoredUser());
  const [token, setToken] = useState(() => authService.getToken());
  // Only "loading" while we verify an existing token on a hard refresh.
  const [loading, setLoading] = useState(() => Boolean(authService.getToken()));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    // Confirms the stored token is still valid and refreshes the user object.
    authService
      .getProfile()
      .then((profile) => {
        if (active && profile) setUser(profile);
      })
      .catch(() => {
        if (!active) return;
        authService.clearSession();
        setUser(null);
        setToken(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const login = useCallback(async (email, password) => {
    const session = await authService.login(email, password);
    setToken(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const register = useCallback(async (payload) => {
    const session = await authService.register(payload);
    if (session.token) setToken(session.token);
    if (session.user) setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo(() => {
    const role = user?.role ?? null;

    return {
      user,
      token,
      role,
      loading,
      isAuthenticated: Boolean(token),
      isCustomer: role === ROLES.CUSTOMER,
      isRider: role === ROLES.RIDER,
      isStore: role === ROLES.STORE,
      isAdmin: role === ROLES.ADMIN,
      login,
      register,
      logout,
      setUser,
    };
  }, [user, token, loading, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

export default AuthContext;