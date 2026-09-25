import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';
import './portal-auth.css';

/**
 * Shared split-screen shell for the staff portal (/login + /register).
 * Left  = brand panel ("Ronex Mart — Supershop Online Portal").
 * Right = the login / signup form. No navbar is rendered on these routes
 * (see App.jsx hideTopNavbar), so this page IS the entry point.
 */
export default function PortalAuth({ mode, children }) {
  const isLogin = mode !== 'register';

  return (
    <div className="portal">
      {/* ---- Left: brand panel ------------------------------------------ */}
      <aside className="portal__brand" aria-label="Ronex Mart introduction">
        <div className="portal__brand-inner">
          <p className="portal__eyebrow">Supershop online portal</p>
          <h1 className="portal__title">
            Ronex Mart
            <span className="portal__title-sub">Supershop Online Portal</span>
          </h1>
          <p className="portal__desc">
            One login for every role that keeps the supershop moving — store
            owners list products and dispatch orders, riders pick up and
            deliver, and admins keep the whole marketplace healthy.
          </p>
          <ul className="portal__roles">
            <li>
              <span className="portal__role-dot portal__role-dot--store" aria-hidden="true" />
              <div>
                <strong>Store owner</strong>
                <span>Open your store, add products, dispatch orders.</span>
              </div>
            </li>
            <li>
              <span className="portal__role-dot portal__role-dot--rider" aria-hidden="true" />
              <div>
                <strong>Rider</strong>
                <span>Accept deliveries and earn on every drop.</span>
              </div>
            </li>
            <li>
              <span className="portal__role-dot portal__role-dot--admin" aria-hidden="true" />
              <div>
                <strong>Admin</strong>
                <span>Oversee stores, riders and the order flow.</span>
              </div>
            </li>
          </ul>
          <p className="portal__hint">
            Shopping with us? Customers sign in from their store&rsquo;s own
            page — no account needed to browse.
          </p>
        </div>
      </aside>

      {/* ---- Right: form -------------------------------------------------- */}
      <div className="portal__form-side">
        <div className="portal__form-wrap">
          <nav className="portal__tabs" aria-label="Login or signup">
            <Link
              to={ROUTES.LOGIN}
              className={isLogin ? 'portal__tab is-active' : 'portal__tab'}
              aria-current={isLogin ? 'page' : undefined}
            >
              Log in
            </Link>
            <Link
              to={ROUTES.REGISTER}
              className={!isLogin ? 'portal__tab is-active' : 'portal__tab'}
              aria-current={!isLogin ? 'page' : undefined}
            >
              Sign up
            </Link>
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
