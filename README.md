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
<!--  -->
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
| `grocer@example.com` | `nina.grocer` | `store` | owns Green Grocer (`/s/green-grocer`) |
| `storeadmin@example.com` | `sara.admin` | `customer` (!) | accepted store-admin membership at Joe's Pizza → opens `/merchant` |
| `admin@example.com` | `ada.admin` | `admin` | `/admin` panel; runs stores only through invitations — **never owns one** |

`sara.admin` is the pattern to copy: a store admin is NOT a special role, it
is an ordinary account + an accepted `StoreRider{ role: 'admin', status:
'active' }` row (seeded via `DEMO_MEMBERSHIPS`). The platform admin joins a
store exactly the same way — a store owner invites `ada.admin` by username,
the admin accepts under `/admin/invitations` — and the whole panel (Dispatch,
Products, Theme) is scoped to those stores only. Each row under **Stores you
run** has a **Remove store** button (`DELETE /riders/stores/:storeId`) that
revokes the membership again; the store can re-invite the account later.

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
  `requireStoreStaff` (owner OR accepted store-admin membership — a platform
  admin only through the stores they run, never a plain role check),
  `requireProductManager`.

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
| `GET` | `/products` | anyone | catalogue (`search`, `category`, `page`); `search` also matches `rack`/`shelf` |
| `GET` | `/products/:id` | anyone | one product |
| `POST` | `/products` | admin / store staff | create (controller checks the product's store is one the caller runs) |
| `PUT` | `/products/:id` | admin / store staff | update |
| `DELETE` | `/products/:id` | admin / store staff | remove |
| `POST` | `/orders` | customer or guest | place an order (server re-prices; guests get a one-time `guestToken`) |
| `GET` | `/orders/mine` | customer | own order history |
| `GET` | `/orders/:id` | customer / assigned rider / store member (incl. admin of that store) | one order (guests: `?guestToken=`) |
| `PATCH` | `/orders/:id/cancel` | customer | cancel before pickup |
| `GET` | `/orders/rider/assigned` | rider | this rider's deliveries |
| `PATCH` | `/orders/:id/status` | assigned rider / admin | advance the status. A rider walks the happy path (or jumps to `delivered`); an admin may only do `confirmed` → `preparing` → `ready_for_pickup` |
| `PATCH` | `/orders/:id/location` | assigned rider | GPS fallback ping |
| `GET` | `/orders` | admin | dispatch board (`status`, `page`) — only orders of stores the admin runs |
| `GET` | `/orders/rider/analytics` | rider | how long each stage of *their* deliveries took |
| `GET` | `/orders/store/analytics` | store staff (owner / appointed store admin) | the same timings for the whole store, rolled up per rider (`storeId` optional) |

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
- **An admin owns the kitchen, not the delivery.** From an order page the admin
  can move it `confirmed` → `preparing` → `ready_for_pickup` and no further: the
  button appears only while the order is sitting at a status they may actually
  change. `ADMIN_STATUS_STEPS` (duplicated in `backend/src/utils/constants.js`
  and `client/src/utils/constants.js`, and read by the button *and* by
  `updateOrderStatus`) is the single table behind it, so the API refuses a skip,
  a rewind, or a self-declared `delivered` with a 403 even if the request is
  hand-made. Pushing it on the road stays the rider's job, and cancelling stays
  the customer's.
- **Every status change is timestamped, and that is the only source of the timing
  numbers.** `applyStatus` (and `claimOrder`) push `{ status, note, by, at }` onto
  `Order.statusHistory`, so a delivery finished last month still reports exactly
  what it took — nothing is counted live and can drift. `deliveryTiming.js` reads
  the history back out and splits a delivery into the three legs that say *who*
  was slow: **prep** (placed → ready, the store), **wait** (ready → picked up,
  the rider), **ride** (picked up → delivered, the rider). The rider's own page
  (`/rider/analytics`) and the store's (`/merchant/analytics`, per rider) both
  come from that one function, so a merchant and a rider reading the same
  delivery always agree. The order tracker shows the whole audit trail —
  every update, when it happened, and how long the step before it lasted — using
  `client/src/utils/timings.js`, a deliberate mirror of the backend helper
  (same reason the constants are duplicated: the tracker holds a single order, so
  there is nothing to ask the server for).
- **Passwords** are bcrypt-hashed with `select: false`, so a hash can never
  leak into a JSON response by accident.
- **CORS** is an allow-list from `CLIENT_ORIGIN` in `backend/.env`, plus any
  `https://*.trycloudflare.com` origin (see `backend/src/app.js`). If you
  serve the client from another port, add that origin or the browser will
  report a network error.
- **Duplicate constants:** `ROLES`, `SOCKET_EVENTS`, order statuses and
  pricing exist in both halves. Changing one means editing
  `client/src/utils/constants.js` *and* `backend/src/utils/constants.js`.
- **Rack / shelf is how you find a product in a big shop.** A product carries
  an optional `rack` + `shelf` ("A3" + "2"), both free text, and a `location`
  virtual that joins them into one line ("Rack A3 · Shelf 2"). They are set in
  the inventory form (`ProductManager.jsx`), listed in its **Location** column
  and matched by its *Find a product* box; `GET /products?search=` also matches
  both, so typing a rack number finds what sits in it. Nothing depends on them —
  a takeaway menu leaves both blank. `formatLocation()` in
  `client/src/utils/formatters.js` prints the em dash when they are unset.
- **Order lines carry a live product lookup, not just a frozen receipt.** An
  order line copies `name`/`price` on purpose — a receipt must never change. But
  `ORDER_POPULATE` in `backend/src/controllers/orderController.js` also fills
  `items.product` with the *current* catalogue row (`name rack shelf category
  image`), because "where do I find this?" is a question about right now: a
  product re-shelved after checkout shows its new rack, not the old one. The
  admin order page (`OrderTracker.jsx` `variant="admin"`) turns that into a
  **Pick list** — numbered in aisle order (A1, A2, A10, with unlocated lines last
  and flagged). A deleted product leaves the line intact with `product: null`,
  which the panel reports as *No location* rather than inventing a shelf.
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
  pages/rider/RiderConsole.jsx, RiderAnalytics.jsx
  pages/store/MerchantDashboard.jsx, RiderTracker.jsx,
                  ThemeBuilder.jsx, StoreRiderAnalytics.jsx
  pages/admin/               AdminDashboard.jsx, AdminInvitations.jsx, ProductManager.jsx
backend/src/
  controllers/authController.js  register/login/me/updateMe/usernameAvailable
  routes/authRoutes.js           POST /register + /login, GET /username-available + /me, PATCH /me
  middleware/auth.js             requireAuth / optionalAuth / requireRole / requireStoreStaff
  models/                        User.js, Store.js, StoreRider.js, StoreCustomer.js,
                                 Product.js, Order.js
  utils/constants.js             ROLES, SELF_SIGNUP_ROLES, statuses (mirror of client!)
  utils/jwt.js                   signToken { sub, role } / verifyToken / bearerFromHeader
  utils/storeAccess.js           storesForUser, loadManageableStore (owner / accepted admin)
  utils/storeCustomer.js         ensureStoreCustomer, customerStoresFor
  seed.js                        DEMO_USERS / DEMO_STORES / DEMO_MEMBERSHIPS / DEMO_PRODUCTS
```

Rules for AI editors: server re-prices every order — never trust a client
total. Store access is decided by `storesForUser()` / membership rows, never
by the platform role alone. A `customer` without a `storeSlug` is rejected at
both doors — that is intentional, not a bug.