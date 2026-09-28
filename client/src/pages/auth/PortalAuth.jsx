import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';
import ronexLogo from '../../assets/images/ronex-mart-logo.png';
import './portal-auth.css';

/**
 * Shared split-screen shell for the staff portal (/login + /register).
 * Left  = brand panel (Ronex Mart logo + "Supershop Online Portal").
 * Right = the login / signup form. No navbar is rendered on these routes
 * (see App.jsx hideTopNavbar), so this page IS the entry point.
 *
 * This one shell is the sign-in page for EVERY staff role — admin, store
 * owner, store admin and rider — so the logo here brands all of them.
 */
export default function PortalAuth({ mode, children }) {
  const isLogin = mode !== 'register';

  return (
    <div className="portal">
      {/* ---- Left: brand panel ------------------------------------------ */}
      <aside className="portal__brand" aria-label="Ronex Mart introduction">
        <div className="portal__brand-inner">
          {/* The logo ships with a white background, so it sits on its own
              white card — the dark panel behind it would swallow the navy
              "MART" and the green stripes. */}
          <div className="portal__logo-card">
            <img
              className="portal__logo"
              src={ronexLogo}
              alt="Ronex Mart"
              width="744"
              height="200"
            />
          </div>
          <h1 className="portal__title">Supershop Online Portal</h1>
          <p className="portal__desc">
            One login for every role that keeps the supershop moving — store
            owners list products and manage orders, riders pick up and deliver,
            and admins keep the whole marketplace healthy.
          </p>
          <ul className="portal__roles">
            <li>
              <span className="portal__role-dot portal__role-dot--store" aria-hidden="true" />
              <div>
                <strong>Store owner</strong>
                <span>Open your store, add products, manage orders.</span>
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
