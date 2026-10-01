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
| **Staff portal** (app entry, NO navbar, split-screen `PortalAuth`: logo + brand panel left, form right) | `/login`, `/register` | rider / store owner / store admin / admin | `client/src/pages/auth/Login.jsx`, `Register.jsx` (+ `PortalAuth.jsx`, `portal-auth.css`) |
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
the admin accepts under `/admin/invitations` — and the whole panel (Orders,
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
| `PATCH` | `/orders/:id/receive` | the buyer — signed-in customer, **or guest with their `guestToken`** | confirm the parcel arrived (`delivered` → `received`). Idempotent, and refused until the rider has actually delivered |
| `GET` | `/orders/:id/review` | the customer who placed it | this delivery's review, or `null`. Only written once the order is `received` |
| `POST` `PUT` | `/orders/:id/review` | the customer who placed it | write or overwrite the review `{ rating, comment }` — 1–5 whole stars, 500 chars max |
| `DELETE` | `/orders/:id/review` | the customer who placed it | withdraw your own review |
| `GET` | `/stores/:id/reviews` | store staff (owner / appointed store admin) | every review left on this store's deliveries, newest first, with the average and a 1–5 histogram |
| `PATCH` | `/orders/:id/location` | assigned rider | GPS fallback ping |
| `POST` | `/payment/init` | the buyer (customer, or guest with their `guestToken`) | open an SSLCommerz sandbox session for an order that **already exists**; `body: { orderId, paymentMethod }` where `paymentMethod` is `card` / `bkash` / `nagad` / `rocket` (`cod` is refused - it never involves the gateway). Returns `{ url, tran_id, amount, channel, multi_card_name }` |
| `POST` | `/payment/success` | SSLCommerz / the banker's browser | validate `val_id`, mark the payment `Paid`, then 302 to `${CLIENT_URL}/payment-success` |
| `POST` | `/payment/fail` | SSLCommerz / the banker's browser | mark `Failed` (never downgrading one already `Paid`), 302 to `/payment-failed` |
| `POST` | `/payment/cancel` | SSLCommerz / the banker's browser | mark `Cancelled`, 302 to `/payment-failed` |
| `POST` | `/payment/ipn` | SSLCommerz's servers | async webhook: re-validate and settle, so a payment still lands even if the shopper never returned |
| `GET` | `/payment/:tranId` | the buyer of that order | what actually happened - status, amount, paidAt, items. What `/payment-success` renders |
| `GET` | `/orders` | admin | orders board (`status`, `page`) — only orders of stores the admin runs |
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
  only admins manage orders and edit the catalogue.
- **Cash on delivery, plus SSLCommerz sandbox for online payment.** `checkout`
  offers both; `paymentMethod` on the order records which was chosen, and a
  `payment` sub-document on the order records how far that payment got
  (`Pending` / `Paid` / `Failed` / `Cancelled`, plus `transactionId`, `val_id`
  and the amount charged). Payment state is deliberately a SEPARATE axis from
  `ORDER_STATUS`: an online payment settles long before the parcel moves, and a
  cash one is only settled by the rider in person.
- **The gateway is charged the order's total, never a number from the client.**
  The brief this was built from has `POST /api/payment/init` create its own order
  from `orderData`; here the order already exists (created by `POST /api/orders`,
  priced server-side, store derived from the products) and `init` takes an
  `orderId`. Otherwise a client could POST `total_amount: 1` and the server would
  cheerfully open a one-taka session for a five-hundred-taka basket.
- **Nothing is marked Paid without asking SSLCommerz.** Every callback path -
  `/success` and the `/ipn` webhook - goes through `settlePayment()`, which
  calls `sslcz.validate(val_id)` and additionally refuses a payment whose amount
  the gateway reports differs from the amount we asked for. The browser redirect
  is a convenience; the IPN is the part that makes this trustworthy, because a
  redirect can be blocked, closed or forged and a webhook cannot.
- **The gateway callbacks are deliberately NOT behind a JWT.** They are made by
  SSLCommerz and by a browser we do not control, so requiring a login would make
  it impossible to ever confirm a payment. Who may *start* a payment is decided
  separately, by `assertOrderOwner()`: seeing an order is not owning it, so the
  assigned rider and store staff - whom `canAccessOrder` deliberately admits -
  cannot charge a customer for their own basket.
- **The checkout offers five channels, and only `card` really filters the
  gateway.** A Rokomari-style custom list — Cash on delivery, bKash, Nagad,
  Rocket, Card — is rendered from `PAYMENT_METHOD_LABELS` + the brand swatches
  in `PAYMENT_METHOD_COLORS`, and the chosen channel is sent as
  `paymentMethod` and stored on `order.payment.channel` so a store can report
  what people actually pick. But `multi_card_name` is SSLCommerz's **CARD-BRAND**
  filter: `card` maps to `visa-mastercard` (a real, documented value that
  genuinely narrows the page), while `bkash` / `nagad` / `rocket` are sent as
  themselves — verified against the sandbox to be **accepted without error, but
  not to deep-link** to that MFS's number-entry screen. The gateway still shows
  its own channel list, because those are mobile financial services that
  SSLCommerz surfaces under its mobile-banking option, not card brands.
  Genuine one-tap bKash/Nagad requires that MFS's own tokenised checkout API —
  a separate integration, not a `multi_card_name` value. The mapping is in
  `PAYMENT_CHANNEL_MULTI_CARD` (backend) and is the single place to change it.
- **`payment.transactionId` is uniquely indexed with a `partialFilterExpression`,
  not `sparse`.** Every cash order stores `null` there, and a sparse index only
  skips *missing* fields - not explicit nulls - so the second COD order in the
  database would fail with a duplicate-key 409. The filter narrows the index to
  documents where the field is actually a string, which is exactly the set of
  orders that went through the gateway.
- **Two gateway traps, both found by testing against the real sandbox, both worth
  knowing before this goes live.**
  1. *The library swallows errors.* `sslcommerz-lts`'s `httpCall` ends in
     `.catch(err => err)`, so a network failure or an unparseable body **resolves**
     with the Error object instead of rejecting. A `try/catch` around
     `client.init()` never fires, and the failure looks exactly like a successful
     response with no `GatewayPageURL`. The controller therefore checks
     `response instanceof Error` and treats that as a gateway failure.
  2. *A missing required field returns an EMPTY body, not a readable error.*
     Bisecting the payload showed `cus_city` / `ship_city` (and the rest of the
     `ship_*` block) are all mandatory at the gateway — but `city` is **optional
     in this app's checkout form**. A shopper who leaves it blank used to get
     "invalid json response body", which reads as "the gateway is unreachable"
     and is nothing of the sort. Every gateway-required field now goes through
     `required()`, which falls back address → store → a default, and through
     `line()`, which strips newlines and non-ASCII (the library builds a
     `form-data` body from raw bytes, so a two-line address corrupts the request
     before it leaves the machine).
- **`BACKEND_URL` and `CLIENT_URL` must be publicly reachable, and the same
  host.** They default to `http://localhost:5000` because this app serves its
  own client from the API. When demoing through the Cloudflare tunnel, set BOTH
  to the tunnel URL - left on localhost, the gateway redirects the customer's
  phone to an address it cannot open. Until `SSLCOMMERZ_STORE_PASSWORD` is
  filled in, `/payment/init` answers 503 with that sentence and cash on delivery
  keeps working.
- **An admin owns the kitchen, not the delivery.** From an order page the admin
  can move it `confirmed` → `preparing` → `ready_for_pickup` and no further: the
  button appears only while the order is sitting at a status they may actually
  change. `ADMIN_STATUS_STEPS` (duplicated in `backend/src/utils/constants.js`
  and `client/src/utils/constants.js`, and read by the button *and* by
  `updateOrderStatus`) is the single table behind it, so the API refuses a skip,
  a rewind, or a self-declared `delivered` with a 403 even if the request is
  hand-made. Pushing it on the road stays the rider's job, and cancelling stays
  the customer's.
- **`delivered` is the rider's claim, `received` is the buyer's.** The rider
  pressing "Mark delivered" only says they dropped the parcel off. Turning that
  into "it is in the buyer's hands" is a separate step *they* take with
  `PATCH /orders/:id/receive` — a distinct status (`received`), not a rename, and
  deliberately absent from `ORDER_STATUS_FLOW` so neither a rider nor the
  server's own transition check can reach it on the rider's behalf. The tracker's
  timeline uses `TRACKER_FLOW` (the rider's flow plus this one stop), while
  everything counting live work filters on `CLOSED_STATUSES`, which treats
  `received` as finished.
- **A guest can confirm receipt, but not review.** Somebody who ordered without
  an account still received the parcel, so `/receive` is `optionalAuth` and
  accepts the `guestToken` from checkout — exactly as `PATCH /orders/:id/cancel`
  already did. The token is the proof: `loadOrderFor` only accepts it for an
  order that has no customer of its own, so a made-up token gets 401 and a
  signed-in account that did not place the order gets 403. The *review* stays
  `requireAuth`, because a rating is a public judgement on a merchant and has to
  be attributable to an account somebody can be held to. The confirmation is
  about a parcel; the review is about a person.
- **A review can only describe a parcel that turned up.** `Review` is one row per
  order (unique index on `order`, so re-submitting *edits* rather than stacking a
  second opinion), and `reviewController.writeReview` refuses with 400 until the
  order is `received` — the rating is evidence about a delivery, not an
  expectation. Whole stars only: half stars are rejected rather than rounded,
  because 4.5 means different things to two people reading a dashboard. Only the
  customer who placed the order may write, read, edit or delete it. Reviews are
  shown to the customer and the store dashboard only — nothing is served on the
  public storefront yet.
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
  `https://*.trycloudflare.com` origin and the backend's own host (see
  `backend/src/config/cors.js`, shared by the REST layer and the socket.io
  handshake so the two can never disagree). If you serve the client from another
  port, add that origin or the browser will report a network error.
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

## Why a storefront opens fast now (all of it measured)

Every number below came from this project's own setup — a local API in front of a
remote Atlas cluster, so **every database round trip is a network round trip**
(50–80ms when the link is calm, multi-second spikes when it is not).

| Symptom (before) | Now |
| --- | --- |
| `GET /api/stores/<slug>` cold: **7,487–8,575ms** | **15–80ms** — nobody waits for a rebuild |
| …and the 30s TTL meant *every* trader's first visit after it paid that | used to be one unlucky visitor every 30s, all day |
| One storefront response: **942,386 bytes**, `content-encoding: -` | **388,925 bytes** on the wire (brotli, −58.7%; gzip −24.9%) |
| The JS bundle, same story | brotli/gzip, and unchanged hashed filenames keep their `immutable` cache |
| First visit after every `node --watch` restart: always the slow one | the API warms the 4 most recently touched storefronts on boot |

Four changes, and what each one protects:

1. **Stale-while-revalidate** (`backend/src/utils/storefrontCache.js`,
   `getAnyBySlug` + `refreshInBackground`). A cached payload past its TTL is
   still ANSWERED FROM while a rebuild runs behind the reader; the TTL now means
   "when to refresh", not "when to make somebody wait". Rules that must not be
   broken: **read `getAnyBySlug` before `getCached`** (the strict read consumes
   an expired entry), a failed rebuild must leave the stale copy in place, and
   every write path must still call `invalidateStore` — a merchant's own edit has
   to show up on their own storefront immediately.
2. **Compression** (`backend/src/middleware/compress.js`, `node:zlib`, no new
   dependency). Brotli when offered, gzip otherwise, skipped below 1KB, for
   already-encoded/range/bodiless responses, and whenever the result would not
   actually be smaller (base64 PNGs). Measured through a Cloudflare quick
   tunnel: the edge always sends `Accept-Encoding: gzip` to the origin and
   never passes brotli across, so over the tunnel a browser gets the gzip
   size (−24.9%) and brotli (−58.7%) applies to direct requests.
3. **Boot warm-up** (`warmStorefronts`, called un-awaited from
   `backend/src/server.js`). Cheap guess, capped at four stores, every failure
   logged and dropped — it can never delay the server accepting traffic.
4. **In-flight request sharing on the client**
   (`client/src/services/storeService.js`). Dedupe only, no cached copy and no
   TTL: several components ask for the same (large) storefront payload in one
   navigation, and a client-side cache with a lifetime of its own is how a
   merchant gets told their own save is not there yet.

Verifying any of it:

```bash
npm --prefix backend run test:cache        # 19 checks, no database needed
npm --prefix backend run test:compression  # 36 checks, no database needed
npm --prefix backend run test:images       # image hosting; skips without credentials
STOREFRONT_CACHE_TTL_MS=1500 npm run dev:backend   # make the stale path reachable in 1.5s
```

## Images live in Cloudinary

An image in this app is a **URL in the database, never bytes**. The browser
downscales the picked file on a canvas and sends a data URL; the API forwards it
to Cloudinary and stores the URL it gets back
(`backend/src/services/cloudinary.js`). That one rule is what removes the
942KB storefront payload: the same picture that cost ~90KB of JSON as base64 is
~120 bytes as a URL, and the browser can then cache it, decode it off the main
thread and range-request it like any other image.

Covered by every image write, all of which funnel through `hostImage`:

| Where | Field |
| --- | --- |
| `PATCH /api/stores/mine` | `logo`, `image` (cover) |
| `PUT /api/menu/edit/:storeId/categories/:name/image` | Theme 1 category cards |
| `PATCH /api/menu/edit/:storeId/tree/:nodeId` | Theme 2 tree cards |
| `POST /api/products`, `PUT /api/products/:id` | product + variant photos |

Details worth knowing:

- **The stored URL carries `q_auto,f_auto`.** Cloudinary then serves WebP/AVIF
  to a browser that can decode one and the original format to everyone else, so
  a shopper on mobile data gets a fraction of the PNG's bytes with no client
  change.
- **`public_id` is deterministic** (`<storeId>-logo`, `<storeId>-category-<name>`),
  so re-uploading a logo **replaces** it instead of leaving yesterday's file in
  the account. Clearing or replacing one deletes the old asset, best effort - a
  Cloudinary outage must not stop a merchant removing a picture.
- **Uploads are signed server-side**, so the secret never reaches the browser
  and there is no public "upload to our account" endpoint. An unsigned upload
  preset would save a hop (phone → Cloudinary directly) but publishes an
  endpoint anyone can push files into; that is a deliberate production
  follow-up, not a default.
- **Credentials are probed, not trusted.** `imageHostingReady()` pings Cloudinary
  once at boot; until that succeeds, images are stored inline exactly as before,
  and `server.js` prints which mode is live. A typo in `.env` therefore degrades
  to the old behaviour instead of failing every upload:

  ```
  [images] hosted on Cloudinary (cloud "d9ok", folder "delivery-app")
  [images] hosting OFF - images are stored inline as base64 (check CLOUDINARY_* in backend/.env)
  ```

Set them in `backend/.env` (git-ignored); `.env.example` documents the names.

### Moving images that are already inline

Code only affects new uploads - rows written before it still hold their
megabytes, and no new code shrinks an old document. The backfill walks every
image field and replaces each inline value with its hosted URL:

```bash
npm --prefix backend run backfill:images            # dry run: reports, writes nothing
npm --prefix backend run backfill:images -- --apply # actually upload
```

A document is saved only after its uploads succeeded, so a failure halfway
leaves a partially migrated database rather than a lost image, and the
storefront cache is invalidated at the end so the change is visible immediately.

## File map for AI editors

```
client/src/
  App.jsx                    route table, HomeRedirect, navbar hiding
  utils/constants.js         ROLES, ROUTES, HOME_ROUTE_BY_ROLE, STORAGE_KEYS, pricing, socket names
  context/AuthContext.jsx    session state + role helpers
  services/authService.js    login/register/me + localStorage session
  services/api.js            axios instance, token attach, 401 handling
  components/common/         ProtectedRoute.jsx, Navbar.jsx, DashboardLayout.jsx
  assets/images/             ronex-mart-logo.png (brand logo on the staff portal)
  pages/auth/                Login.jsx, Register.jsx, PortalAuth.jsx (+ portal-auth.css)
                             CustomerLogin.jsx, CustomerRegister.jsx (+ customer-auth.css)
  pages/customer/            Storefront.jsx, ShopPage.jsx, Checkout.jsx, OrderTracker.jsx
  pages/rider/RiderConsole.jsx, RiderAnalytics.jsx
  pages/store/MerchantDashboard.jsx, RiderTracker.jsx,
                  ThemeBuilder.jsx, StoreRiderAnalytics.jsx
  pages/admin/               AdminDashboard.jsx, AdminInvitations.jsx, ProductManager.jsx
  components/store/          OrderReview.jsx (the stars + note form),
                              ReviewDialog.jsx (the popup it opens in, shown the
                              moment a receipt is confirmed)
backend/src/
  controllers/authController.js  register/login/me/updateMe/usernameAvailable
  routes/authRoutes.js           POST /register + /login, GET /username-available + /me, PATCH /me
  middleware/auth.js             requireAuth / optionalAuth / requireRole / requireStoreStaff
  models/                        User.js, Store.js, StoreRider.js, StoreCustomer.js,
                                 Product.js, Order.js
  controllers/reviewController.js write/overwrite/read/withdraw a customer's review,
                                  plus the store's review list (average + histogram)
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
