const fs = require("fs");
const p = "client/src/App.jsx";
let c = fs.readFileSync(p, "utf8");

// Replace the dangling comment fragment on line 139
// Current: "              Side-navbar shell instead of the top navbar. */}"
// Should be: "          {/* Admin panel. Side-navbar shell instead of the top navbar. */}"
c = c.replace(
  "              Side-navbar shell instead of the top navbar. */}",
  "          {/* Admin panel. Side-navbar shell instead of the top navbar. */}"
);

fs.writeFileSync(p, c);
const idx = c.indexOf("Admin panel");
console.log("Found at:", idx, "Context:", JSON.stringify(c.slice(idx, idx + 80)));

