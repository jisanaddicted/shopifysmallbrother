import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import authService from '../services/authService';
import { HOME_ROUTE_BY_ROLE, ROLES, shopPath } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authService.getStoredUser());
  const [token, setToken] = useState(() => authService.getToken());
  // Every store this account runs, as [{ store, role }] - "owner" or "admin".
  const [stores, setStores] = useState(() => authService.getStoredStores());
  // Every store this account *shops at*, as [{ store, status, source, ... }].
  // A customer who signed up at /s/<slug> has that store here.
  const [customerStores, setCustomerStores] = useState(() =>
    authService.getStoredCustomerStores(),
  );
  // Only "loading" while we verify an existing token on a hard refresh.
  const [loading, setLoading] = useState(() => Boolean(authService.getToken()));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    // Confirms the stored token is still valid and refreshes the user object
    // together with the lists of stores the account runs and shops at.
    authService
      .getProfile()
      .then((profile) => {
        if (!active) return;
        if (profile.user) setUser(profile.user);
        setStores(profile.stores || []);
        setCustomerStores(profile.customerStores || []);
      })
      .catch(() => {
        if (!active) return;
        authService.clearSession();
        setUser(null);
        setToken(null);
        setStores([]);
        setCustomerStores([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  // `storeSlug` is the store page the shopper signed in from. Sending it makes
  // that store one of theirs.
  const login = useCallback(async (email, password, storeSlug) => {
    const session = await authService.login(email, password, storeSlug);
    setToken(session.token);
    setUser(session.user);
    setStores(session.stores || []);
    setCustomerStores(session.customerStores || []);
    return session.user;
  }, []);

  const register = useCallback(async (payload) => {
    const session = await authService.register(payload);
    if (session.token) setToken(session.token);
    if (session.user) setUser(session.user);
    setStores(session.stores || []);
    setCustomerStores(session.customerStores || []);
    return session.user;
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setUser(null);
    setToken(null);
    setStores([]);
    setCustomerStores([]);
  }, []);

  // Re-reads the session - after accepting a store-admin invitation the new
  // store appears without a fresh sign-in.
  const refreshSession = useCallback(async () => {
    const profile = await authService.getProfile();
    if (profile.user) setUser(profile.user);
    setStores(profile.stores || []);
    setCustomerStores(profile.customerStores || []);
    return profile;
  }, []);

  const value = useMemo(() => {
    const role = user?.role ?? null;
    // A store admin keeps their platform role (often `customer`) - what gives
    // them the dashboard is this list from the session, not their role.
    const runsStore = stores.length > 0;
    const storeRole = stores[0]?.role || null;

    // Just the store documents - the shape the UI wants for "my stores".
    const shoppingStores = customerStores
      .map((entry) => entry.store)
      .filter(Boolean);
    // Only a plain shopper gets the customer experience: a store admin who
    // shopped somewhere keeps their dashboard.
    const shopsAtStores =
      role === ROLES.CUSTOMER && !runsStore && shoppingStores.length > 0;

    // Where this account lands: its platform role's home, except store staff -
    // owners (role `store`) and store admins (role `storeadmin`, or any account
    // with an accepted appointment) land on the store dashboard.
    const homeRoute =
      role === ROLES.STORE ||
      role === ROLES.STORE_ADMIN ||
      (runsStore && role !== ROLES.ADMIN)
        ? HOME_ROUTE_BY_ROLE[ROLES.STORE]
        : HOME_ROUTE_BY_ROLE[role] || '/';

    // Where a *customer* should land: the store they signed up at, so the
    // account always leads back to the storefront it belongs to.
    const customerHomeRoute =
      shopsAtStores && shoppingStores[0]?.slug
        ? shopPath(shoppingStores[0].slug)
        : null;

    return {
      user,
      token,
      role,
      stores,
      storeRole,
      runsStore,
      customerStores,
      shoppingStores,
      shopsAtStores,
      homeRoute,
      customerHomeRoute,
      loading,
      isAuthenticated: Boolean(token),
      isCustomer: role === ROLES.CUSTOMER && !runsStore,
      isRider: role === ROLES.RIDER,
      isStore:
        role === ROLES.STORE || role === ROLES.STORE_ADMIN || runsStore,
      isAdmin: role === ROLES.ADMIN,
      isStoreOwner: role === ROLES.STORE || storeRole === 'owner',
      /** The session entry for a store slug, or null. */
      customerStoreEntry: (slug) =>
        customerStores.find((entry) => entry.store?.slug === slug) || null,
      login,
      register,
      logout,
      refreshSession,
      setUser,
      setStores,
      setCustomerStores,
    };
  }, [
    user,
    token,
    stores,
    customerStores,
    loading,
    login,
    register,
    logout,
    refreshSession,
  ]);

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