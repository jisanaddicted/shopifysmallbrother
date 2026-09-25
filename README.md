# Ronex Mart — Supershop Online Portal (Delivery App)

A delivery-ordering stack: a React 18 + Vite + React Router browser app
(`client/`) powered by an Express 4 + MongoDB (Mongoose) + socket.io API
(`backend/`). The two halves are independent npm projects; the root
`package.json` starts/builds everything from one place.

```
javascriptpractice/
├── client/     React 18 + Vite + React Router (the browser app)
└── backend/    Express 4 + MongoDB (Mongoose) + socket.io (REST + live tracking)
```

## Roles — the one table that matters

Platform roles live in `ROLES`, mirrored in `client/src/utils/constants.js`
and `backend/src/utils/constants.js` (keep both in sync). There are **five**
user roles:

| Role value | Who | Home after login | Notes |
| --- | --- | --- | --- |
| `customer` | Shopper | their store (`/s/<slug>`) | Belongs to a store; created ONLY at `/s/<slug>/register` |
| `rider` | Delivery rider | `/rider` | MUST have a unique `username` (how stores find them) |
| `store` | Store owner | `/merchant` | MUST have `username`; signup auto-creates their `Store` + `/s/<slug>` page |
| `storeadmin` | Wants to work at a store | `/merchant` once appointed | MUST have `username`; an owner appoints them afterwards |
| `admin` | Platform admin | `/admin` | NEVER self-signed-up — seeder or existing admin only |

Two extra concepts that are NOT platform roles:

- **Store membership** (`StoreRider` row: `{ store, rider, role:
  'rider'|'admin', status }`). A *store admin* is whoever holds an **accepted
  (`active`) membership with `role: 'admin'`** — they keep their own platform
  role (often `customer`). What opens the dashboard is the membership list in
  their session, not the role.
- **Store customer** (`StoreCustomer` row): which stores an account shops at.
  Created on store signup/login/order. A store can set a customer to
  `blocked`.

Self-signup allow-list (`SELF_SIGNUP_ROLES`): `customer, rider, store,
storeadmin`. Anything else (or nothing) falls back to `customer`, so nobody
can register as `admin`. Usernames are required for `rider, store,
storeadmin` (`ROLES_REQUIRING_USERNAME`).

## The two auth doors — do not mix them

| Door | URLs | Who | Components |
| --- | --- | --- | --- |
| **Staff portal** (app entry, NO navbar, split-screen `PortalAuth`: brand panel left, form right) | `/login`, `/register` | rider / store owner / store admin / admin | `client/src/pages/auth/Login.jsx`, `Register.jsx` (+ `PortalAuth.jsx`, `portal-auth.css`) |
| **Store-branded customer auth** (the slug IS the store context) | `/s/:slug/login`, `/s/:slug/register` | customers only | `CustomerLogin.jsx`, `CustomerRegister.jsx` (+ `customer-auth.css`) |

`/` redirects logged-out visitors to `/login` and logged-in users to their
role home (`HomeRedirect` in `client/src/App.jsx`). The top `<Navbar/>` is
hidden on `/login`, `/register`, `/merchant*`, `/admin*` and `/s/*`.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20+ | the backend uses `node --watch` and top-level `await` |
| MongoDB | a local server **or** a MongoDB Atlas cluster |

The connection string lives in `backend/.env` (`MONGO_URI`). A local server is
the fallback default (`mongodb://127.0.0.1:27017/delivery_app`).

## Connecting to MongoDB Atlas

```ini
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/delivery_app?retryWrites=true&w=majority&appName=<app>
```

Two gotchas that produce confusing errors:

1. **Include the database name.** The part between the last `/` and the `?` is
   the database. Atlas' copy button often omits it, and Mongoose then quietly
   writes to a database called `test`.
2. **`querySrv ECONNREFUSED` is usually DNS, not Atlas.** `mongodb+srv://`
   needs an SRV lookup, and some routers/VPNs refuse those queries — Node's
   resolver reports it as a connection refusal, which looks like a dead
   cluster. Check with `Resolve-DnsName -Type SRV _mongodb._tcp.<cluster>.mongodb.net`.
   If Windows resolves it but Node doesn't, set:

   ```ini
   MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1
   ```

Also make sure this machine's public IP is on the cluster's
**Network Access** allow-list, otherwise the connection times out.

## Quick start

```bash
# 1. install everything (root tooling + both packages)
npm run install:all

# 2. copy the API environment file
copy backend\.env.example backend\.env      # Windows
# cp backend/.env.example backend/.env      # macOS / Linux

# 3. start the API (5000) and the web app (5173) together
npm run dev
```

Open <http://localhost:5173> — `/` sends you to the portal `/login`. Click a
**Demo accounts** chip and sign in. The API creates those accounts
automatically on boot (`AUTO_SEED=true`).

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web app together |
| `npm run dev:backend` | API only (auto-restarts on change) |
| `npm run dev:client` | web app only |
| `npm run seed` | (re)create the demo users and sample products |
| `npm run test:smoke` | end-to-end API test — run it while the API is up |
| `npm run build` | production build of the client |

## Demo accounts (password `password123` for all)

Kept in sync between `backend/src/seed.js` (`DEMO_USERS`, auto-seeded on boot
when `AUTO_SEED=true`) and the demo chips on the portal login page
(`client/src/pages/auth/Login.jsx`).

| Email | Username | Platform role | What it shows |
| --- | --- | --- | --- |
| `customer@example.com` | — | `customer` | shops at Joe's Pizza |
| `rider@example.com` | `sam.rider` | `rider` | `/rider` console |
| `store@example.com` | `joe.merchant` | `store` | owns Joe's Pizza (`/s/joes-pizza`) |
| `storeadmin@example.com` | `sara.admin` | `customer` (!) | accepted store-admin membership at Joe's Pizza → opens `/merchant` |
| `admin@example.com` | `ada.admin` | `admin` | `/admin` panel; also owns Green Grocer (`/s/green-grocer`) |

`sara.admin` is the pattern to copy: a store admin is NOT a special role, it
is an ordinary account + an accepted `StoreRider{ role: 'admin', status:
'active' }` row (seeded via `DEMO_MEMBERSHIPS`).

## Session shape (what login/register return)

`POST /auth/login` (200) and `POST /auth/register` (201) both answer:

```json
{
  "token": "<JWT, payload { sub: userId, role }, default expiry 7d>",
  "user": { "_id": "...", "name": "...", "email": "...", "username": "...", "role": "rider" },
  "store": "{...primary store or null}",
  "stores": [{ "store": { "..." }, "role": "owner|admin" }],
  "customerStores": [{ "store": { "..." }, "status": "active", "source": "signup|login|order" }]
}
```

- `stores` = stores the account **runs** (owned first, then accepted admin
  memberships — see `storesForUser()` in `backend/src/utils/storeAccess.js`).
- `customerStores` = stores the account **shops at**.
- The client persists all four pieces in localStorage (`da.token`, `da.user`,
  `da.stores`, `da.customerStores`) and re-validates via `GET /auth/me` on
  every hard refresh (`AuthContext`).

## Backend auth rules (`backend/src/controllers/authController.js`)

- **Register** accepts `{ name, email, phone, username, password, role,
  storeName, storeSlug }`. A role outside `SELF_SIGNUP_ROLES` falls back to
  `customer`. `role: 'store'` creates a `Store` (unique slug from `storeName
  || name`) — the owner gets `/s/<slug>` instantly. `role: 'customer'`
  REQUIRES `storeSlug` (400 otherwise: *"Customer accounts are created at a
  store"*). Usernames are validated (`3-20 chars, [a-z0-9._-], starts with a
  letter`) and unique (409 on clash); email unique (409). Passwords are
  bcrypt-hashed, `passwordHash` is `select: false` and stripped from JSON.
- **Login** accepts ONE identifier field (`email` / `username` / `identifier`)
  matched against email OR username, plus `password`. Wrong credentials give a
  generic 401 (*"Invalid email or password"* — no user enumeration). A
  `customer` MUST send the `storeSlug` of the store page they sign in from
  (403 otherwise: *"Customer sign-in happens at your store's page"*); the
  login records/refreshes their `StoreCustomer` row (`source: 'login'`).
- `GET /auth/username-available?username=` — live handle check for signup.
- `GET /auth/me` (token required) — re-validates the token and rebuilds both
  store lists, so a fresh appointment works without re-login. `PATCH /auth/me`
  — edit own name/phone; riders can also toggle `isAvailable` + `location`.
- Guards (`backend/src/middleware/auth.js`): `requireAuth` (Bearer token →
  fresh `req.user`, so role changes apply immediately), `optionalAuth` (guests
  continue as `req.user === null` for guest checkout), `requireRole(...)`,
  `requireStoreStaff` (owner OR accepted store-admin membership OR platform
  admin — never a plain role check), `requireProductManager`.

## API

Base URL: `http://localhost:5000/api` (or the tunnel origin + `/api` when
deployed as one URL — the backend serves `client/dist` itself, see
`backend/src/app.js`). Auth header: `Authorization: Bearer <token>`. Public
routes: `/auth/login`, `/auth/register`, `/auth/username-available`,
`GET /products`, storefront/menu reads, guest checkout + guest tracker.
Errors always answer `{ message }` (+ `errors` for validation failures) —
exactly what `client/src/services/api.js` unwraps (it also turns a
no-response network failure into *"Cannot reach the API server at
<baseURL>"*).

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | anyone | liveness + database state |
| `POST` | `/auth/register` | anyone | create rider / store / store-admin; customers ONLY with `storeSlug` → 201 `{ token, user, store, stores, customerStores }` |
| `POST` | `/auth/login` | anyone | email-OR-username + password; customers MUST send `storeSlug` → `{ token, user, store, stores, customerStores }` |
| `GET` | `/auth/username-available` | anyone | is a handle free? |
| `GET` | `/auth/me` | signed in | re-validate token, refresh `stores` + `customerStores` |
| `PATCH` | `/auth/me` | signed in | edit own name / phone / availability |
| `GET` | `/products` | anyone | catalogue (`search`, `category`, `page`) |
| `GET` | `/products/:id` | anyone | one product |
| `POST` | `/products` | admin / store staff | create (controller checks the product's store is one the caller runs) |
| `PUT` | `/products/:id` | admin / store staff | update |
| `DELETE` | `/products/:id` | admin / store staff | remove |
| `POST` | `/orders` | customer or guest | place an order (server re-prices; guests get a one-time `guestToken`) |
| `GET` | `/orders/mine` | customer | own order history |
| `GET` | `/orders/:id` | customer / assigned rider / admin | one order (guests: `?guestToken=`) |
| `PATCH` | `/orders/:id/cancel` | customer | cancel before pickup |
| `GET` | `/orders/rider/assigned` | rider | this rider's deliveries |
| `PATCH` | `/orders/:id/status` | assigned rider / admin | advance the status (happy-path order enforced) |
| `PATCH` | `/orders/:id/location` | assigned rider | GPS fallback ping |
| `GET` | `/orders` | admin | dispatch board (`status`, `page`) |
| `PATCH` | `/orders/:id/assign` | admin | assign / unassign a rider |
| `GET` | `/admin/riders` | admin | riders for the dispatch dropdown |

Stores / riders / menus / users live under `/stores`, `/riders`, `/menu`,
`/users`, `/admin` — read `backend/src/routes/*.js` plus the matching
controller for exact paths (username invites, accept/decline, customer lists).

Errors always answer with `{ message }` (plus `errors` for validation
failures) — which is exactly what `client/src/services/api.js` unwraps.

## Socket.io

Same port as the REST API. The JWT goes in the handshake
(`auth: { token }`), and **room access is checked server-side**: you can only
join an order room you own, are delivering, or administer.

| Direction | Event | Payload |
| --- | --- | --- |
| client → server | `order:join` | `{ orderId }` |
| client → server | `order:leave` | `{ orderId }` |
| client → server | `rider:location` | `{ orderId, lat, lng, accuracy, heading, speed }` |
| server → client | `rider:location:updated` | `{ orderId, lat, lng, at }` |
| server → client | `order:status:updated` | `{ orderId, status, note, at }` |
| server → client | `server:error` | `{ orderId?, message }` |

## Frontend auth flow (`client/src/`)

- `services/authService.js` — `login(email, password, storeSlug)`,
  `register(payload)`, `getProfile()` (`GET /auth/me`), `checkUsername()`,
  and session persistence (`da.token`, `da.user`, `da.stores`,
  `da.customerStores`).
- `context/AuthContext.jsx` — session state plus the derived values AI code
  must use: `runsStore` (`stores.length > 0`), `homeRoute`,
  `customerHomeRoute`, `isCustomer` (`role === 'customer' && !runsStore` — a
  store admin who shops somewhere is NOT a customer), `isStore` (owner OR
  `storeadmin` OR `runsStore`), `refreshSession()` (call after accepting an
  invitation so the dashboard opens without re-login).
- `components/common/ProtectedRoute.jsx` — not logged in → `/login`
  (remembers `from`); wrong role → own home page. Store routes use an
  **effective role**: `(runsStore || role === 'storeadmin') && role !==
  'admin'` counts as `store`, so appointed admins pass
  `allowedRoles={[ROLES.STORE]}`.
- After login the portal returns users to `location.state.from` (or their role
  home); `/register` from a store page sends customers back to that
  storefront. Logout: customers → last `/s/<slug>` visit (`da.lastStore`),
  staff → `/login` (`Navbar.jsx`). A 401 on a request that SENT a token wipes
  the session and bounces to `/login` — except guest-tracker 401s (no token
  sent) and the instant after a deliberate logout (`services/api.js`).

## Things worth knowing

- **Money rules are duplicated on purpose.** `backend/src/utils/pricing.js`
  mirrors `DELIVERY_FEE` / `FREE_DELIVERY_OVER` from
  `client/src/utils/constants.js`: free delivery once the basket reaches 50,
  otherwise a 2.50 fee. The server always recalculates the total from the
  catalogue, so a tampered cart cannot set its own price.
- **Roles are enforced on the server**, not just hidden in the UI. Riders may
  only move an order along the happy path (or jump straight to `delivered`);
  only admins dispatch and edit the catalogue.
- **Passwords** are bcrypt-hashed with `select: false`, so a hash can never
  leak into a JSON response by accident.
- **CORS** is an allow-list from `CLIENT_ORIGIN` in `backend/.env`, plus any
  `https://*.trycloudflare.com` origin (see `backend/src/app.js`). If you
  serve the client from another port, add that origin or the browser will
  report a network error.
- **Duplicate constants:** `ROLES`, `SOCKET_EVENTS`, order statuses and
  pricing exist in both halves. Changing one means editing
  `client/src/utils/constants.js` *and* `backend/src/utils/constants.js`.
- `backend/.env` is git-ignored; only `.env.example` is committed.

## File map for AI editors

```
client/src/
  App.jsx                    route table, HomeRedirect, navbar hiding
  utils/constants.js         ROLES, ROUTES, HOME_ROUTE_BY_ROLE, STORAGE_KEYS, pricing, socket names
  context/AuthContext.jsx    session state + role helpers
  services/authService.js    login/register/me + localStorage session
  services/api.js            axios instance, token attach, 401 handling
  components/common/         ProtectedRoute.jsx, Navbar.jsx, DashboardLayout.jsx
  pages/auth/                Login.jsx, Register.jsx, PortalAuth.jsx (+ portal-auth.css)
                             CustomerLogin.jsx, CustomerRegister.jsx (+ customer-auth.css)
  pages/customer/            Storefront.jsx, ShopPage.jsx, Checkout.jsx, OrderTracker.jsx
  pages/rider/RiderConsole.jsx
  pages/store/MerchantDashboard.jsx
  pages/admin/               AdminDashboard.jsx, AdminStores.jsx, ProductManager.jsx
backend/src/
  controllers/authController.js  register/login/me/updateMe/usernameAvailable
  routes/authRoutes.js           POST /register + /login, GET /username-available + /me, PATCH /me
  middleware/auth.js             requireAuth / optionalAuth / requireRole / requireStoreStaff
  models/                        User.js, Store.js, StoreRider.js, StoreCustomer.js,
                                 Product.js, Order.js
  utils/constants.js             ROLES, SELF_SIGNUP_ROLES, statuses (mirror of client!)
  utils/jwt.js                   signToken { sub, role } / verifyToken / bearerFromHeader
  utils/storeAccess.js           storesForUser, loadManageableStore (owner/admin/platform)
  utils/storeCustomer.js         ensureStoreCustomer, customerStoresFor
  seed.js                        DEMO_USERS / DEMO_STORES / DEMO_MEMBERSHIPS / DEMO_PRODUCTS
```

Rules for AI editors: server re-prices every order — never trust a client
total. Store access is decided by `storesForUser()` / membership rows, never
by the platform role alone. A `customer` without a `storeSlug` is rejected at
both doors — that is intentional, not a bug.