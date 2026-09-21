import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import authService from '../services/authService';
import { HOME_ROUTE_BY_ROLE, ROLES } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authService.getStoredUser());
  const [token, setToken] = useState(() => authService.getToken());
  // Every store this account runs, as [{ store, role }] - "owner" or "admin".
  const [stores, setStores] = useState(() => authService.getStoredStores());
  // Only "loading" while we verify an existing token on a hard refresh.
  const [loading, setLoading] = useState(() => Boolean(authService.getToken()));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    // Confirms the stored token is still valid and refreshes the user object
    // together with the list of stores the account runs.
    authService
      .getProfile()
      .then((profile) => {
        if (!active) return;
        if (profile.user) setUser(profile.user);
        setStores(profile.stores || []);
      })
      .catch(() => {
        if (!active) return;
        authService.clearSession();
        setUser(null);
        setToken(null);
        setStores([]);
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
    setStores(session.stores || []);
    return session.user;
  }, []);

  const register = useCallback(async (payload) => {
    const session = await authService.register(payload);
    if (session.token) setToken(session.token);
    if (session.user) setUser(session.user);
    setStores(session.stores || []);
    return session.user;
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    setToken(null);
    setStores([]);
  }, []);

  // Re-reads the session - after accepting a store-admin invitation the new
  // store appears without a fresh sign-in.
  const refreshSession = useCallback(async () => {
    const profile = await authService.getProfile();
    if (profile.user) setUser(profile.user);
    setStores(profile.stores || []);
    return profile;
  }, []);

  const value = useMemo(() => {
    const role = user?.role ?? null;
    // A store admin keeps their platform role (often `customer`) - what gives
    // them the dashboard is this list from the session, not their role.
    const runsStore = stores.length > 0;
    const storeRole = stores[0]?.role || null;

    // Where this account lands: its platform role's home, except store staff -
    // owners (role `store`) and store admins (role `storeadmin`, or any account
    // with an accepted appointment) land on the store dashboard.
    const homeRoute =
      role === ROLES.STORE ||
      role === ROLES.STORE_ADMIN ||
      (runsStore && role !== ROLES.ADMIN)
        ? HOME_ROUTE_BY_ROLE[ROLES.STORE]
        : HOME_ROUTE_BY_ROLE[role] || '/';

    return {
      user,
      token,
      role,
      stores,
      storeRole,
      runsStore,
      homeRoute,
      loading,
      isAuthenticated: Boolean(token),
      isCustomer: role === ROLES.CUSTOMER && !runsStore,
      isRider: role === ROLES.RIDER,
      isStore:
        role === ROLES.STORE || role === ROLES.STORE_ADMIN || runsStore,
      isAdmin: role === ROLES.ADMIN,
      isStoreOwner: role === ROLES.STORE || storeRole === 'owner',
      login,
      register,
      logout,
      refreshSession,
      setUser,
      setStores,
    };
  }, [user, token, stores, loading, login, register, logout, refreshSession]);

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