# Delivery App

A small delivery-ordering stack: a React storefront plus the Express/MongoDB
API and socket.io server that powers it.

```
javascriptpractice/
├── client/     React 18 + Vite + React Router (the browser app)
└── backend/    Express 4 + MongoDB (Mongoose) + socket.io (REST + live tracking)
```

The two halves are independent npm projects, but the root `package.json` gives
you one place to start everything.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20+ | the backend uses `node --watch` and top-level `await` |
| MongoDB 4.4+ | running locally, or any connection string you provide |

MongoDB is expected on `mongodb://127.0.0.1:27017` by default — change
`MONGO_URI` in `backend/.env` if yours lives elsewhere.

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

Open <http://localhost:5173>, click a **Demo accounts** chip and sign in.
The API creates those accounts automatically on boot (`AUTO_SEED=true`).

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web app together |
| `npm run dev:backend` | API only (auto-restarts on change) |
| `npm run dev:client` | web app only |
| `npm run seed` | (re)create the demo users and sample products |
| `npm run test:smoke` | end-to-end API test — run it while the API is up |
| `npm run build` | production build of the client |

## Demo accounts

All three use the password `password123` (see `backend/src/seed.js` and
`client/src/pages/auth/Login.jsx` — keep the two in sync).

| Email | Role | Lands on |
| --- | --- | --- |
| `customer@example.com` | customer | `/store` |
| `rider@example.com` | rider | `/rider` |
| `admin@example.com` | admin | `/admin` |

## API

Base URL: `http://localhost:5000/api`. Everything except `/auth/login`,
`/auth/register` and `GET /products` needs `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | anyone | liveness + database state |
| `POST` | `/auth/register` | anyone | create a customer or rider |
| `POST` | `/auth/login` | anyone | returns `{ token, user }` |
| `GET` | `/auth/me` | signed in | re-validate the stored token |
| `PATCH` | `/auth/me` | signed in | edit own name / phone / availability |
| `GET` | `/products` | anyone | catalogue (`search`, `category`, `page`) |
| `GET` | `/products/:id` | anyone | one product |
| `POST` | `/products` | admin | create |
| `PUT` | `/products/:id` | admin | update |
| `DELETE` | `/products/:id` | admin | remove |
| `POST` | `/orders` | customer | place an order (server re-prices it) |
| `GET` | `/orders/mine` | customer | own order history |
| `GET` | `/orders/:id` | customer / assigned rider / admin | one order |
| `PATCH` | `/orders/:id/cancel` | customer | cancel before pickup |
| `GET` | `/orders/rider/assigned` | rider | this rider's deliveries |
| `PATCH` | `/orders/:id/status` | assigned rider / admin | advance the status |
| `PATCH` | `/orders/:id/location` | assigned rider | GPS fallback ping |
| `GET` | `/orders` | admin | dispatch board (`status`, `page`) |
| `PATCH` | `/orders/:id/assign` | admin | assign / unassign a rider |
| `GET` | `/admin/riders` | admin | riders for the dispatch dropdown |

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
- **CORS** is an allow-list from `CLIENT_ORIGIN` in `backend/.env`. If you
  serve the client from another port, add that origin or the browser will
  report a network error.
- **Duplicate constants:** `SOCKET_EVENTS` and the order statuses exist in both
  halves. Changing a status means editing `client/src/utils/constants.js` *and*
  `backend/src/utils/constants.js`.
- `backend/.env` is git-ignored; only `.env.example` is committed.