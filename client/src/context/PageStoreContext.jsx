import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * "Which store is this screen about?" - asked by the navbar, answered by the page.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The navbar is rendered by App.jsx, ABOVE the routed page, so a page has never
 * been able to say anything about it. That worked while the brand slot had only
 * one source - the signed-in customer's own store, from the session - but it
 * broke the moment a page knew something better than the session did.
 *
 * The order tracker is exactly that page. `/track/:orderId` is opened by guests
 * (a shared tracking link, a guest checkout) and by customers whose session has
 * no `customerStores` yet, and in both cases the navbar fell through to its
 * generic "DeliveryApp" wordmark. So the one screen where somebody is watching a
 * specific shop's rider approach their door was branded as the generic app.
 *
 * Meanwhile the answer was sitting in the page's own state: `order.store`. It
 * did not need a second request, a guess from the URL, or a localStorage
 * fallback - it just had no way to reach a component rendered above it.
 *
 * WHY A CONTEXT AND NOT A PROP
 *
 * The consumer (Navbar) and the producer (OrderTracker) have no common parent
 * except App, and App does not know which store any given route belongs to -
 * that is precisely the per-page knowledge this carries. So the page publishes
 * into a store the navbar reads, and neither has to know about the other.
 *
 * The provider is mounted in main.jsx AROUND `<App />`, which is what puts the
 * navbar and the routed page inside the same provider. Mounting it inside a page
 * would be the same mistake in a new place: the navbar would be outside it.
 */
const PageStoreContext = createContext(null);

/** Shared no-op so the fallback below is a stable identity (see usePageStore). */
const NOOP = () => {};

/** "No page published anything" - also what a cleared brand resets to. */
const NO_BRAND = { store: null, logoOnly: false };

export function PageStoreProvider({ children }) {
  /* One object, not two pieces of state, so `logoOnly` can never outlive the
     store it was set for: clearing the store clears the flag in the same write,
     which is what stops a page that wanted a bare logo from leaving the NEXT
     page's brand nameless. */
  const [brand, setBrand] = useState(NO_BRAND);

  /* Stable on purpose. A page publishes from inside an effect, so this setter
     is in that effect's dependency list - a new function identity on every
     render would re-run the publishing effect on every render, forever.

     `options.logoOnly` asks for the store's MARK without its name. The
     customer's tracker wants that: on a phone the bar is a 30px logo at the
     very top of a screen whose whole job is watching one delivery, and the
     store's name is already spelled out in the page itself - printing it twice,
     in a 12rem-ellipsised strip, is noise. It is the same call StoreHeader
     makes on the storefront header, for the same reason. */
  const publishStore = useCallback((next, options) => {
    setBrand({
      store: next || null,
      logoOnly: Boolean(options?.logoOnly),
    });
  }, []);

  const value = useMemo(
    () => ({
      store: brand.store,
      logoOnly: brand.logoOnly,
      setStore: publishStore,
    }),
    [brand, publishStore],
  );

  return (
    <PageStoreContext.Provider value={value}>{children}</PageStoreContext.Provider>
  );
}

/**
 * `{ store, logoOnly, setStore }` - the store the current page published, how it
 * wants to be branded, and the setter to publish with.
 *
 * A no-op default instead of a throw (which is what `useAuth` does), because
 * this is read on EVERY page rather than by one feature: the navbar asks for it
 * to decide what to draw, so a missing provider has to degrade to the default
 * brand, not blank the app. `NOOP` is module-level so a page that publishes
 * without a provider still gets a stable setter and cannot loop.
 */
export function usePageStore() {
  const context = useContext(PageStoreContext);
  if (!context) return { store: null, logoOnly: false, setStore: NOOP };
  return context;
}

export default PageStoreContext;
