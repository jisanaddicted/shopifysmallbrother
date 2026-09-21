const fs = require("fs");
const p = "client/src/App.jsx";
let c = fs.readFileSync(p, "utf8");

// Find the merchant comment and replace everything from there to the
// "store's public page" comment, preserving the public-shop route.
const startMarker = "{/* Store owner";
const endMarker = "{/* A store's public page";

const startIdx = c.indexOf(startMarker);
const endIdx = c.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.log("Markers not found!", startIdx, endIdx);
  process.exit(1);
}

const before = c.slice(0, startIdx);
const after = c.slice(endIdx);

const replacement = `          {/* Store owner and store admins the owner appointed.
              Side-navbar shell instead of the top navbar. */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[ROLES.STORE]}>
                <DashboardLayout variant="merchant" />
              </ProtectedRoute>
            }
          >
            <Route
              path={ROUTES.MERCHANT_DASHBOARD}
              element={<MerchantDashboard />}
            />
            <Route path={ROUTES.MERCHANT_PRODUCTS} element={<ProductManager />} />
            <Route path={ROUTES.MERCHANT_THEME} element={<ThemeBuilder />} />
          </Route>

          {/* Admin panel. Side-navbar shell instead of the top navbar. */}
          <Route
            element={
              <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                <DashboardLayout variant="admin" />
              </ProtectedRoute>
            }
          >
            <Route
              path={ROUTES.ADMIN_DASHBOARD}
              element={<AdminDashboard />}
            />
            <Route path={ROUTES.ADMIN_PRODUCTS} element={<ProductManager />} />
            <Route path={ROUTES.ADMIN_STORES} element={<AdminStores />} />
            <Route path={ROUTES.ADMIN_THEME} element={<ThemeBuilder />} />
          </Route>

          ${endMarker}`;

c = before + replacement + after.slice(endMarker.length);
fs.writeFileSync(p, c);
console.log("Rewrote merchant+admin routes. New file length:", c.length, "chars.");

