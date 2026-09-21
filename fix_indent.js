const fs = require("fs");
const p = "client/src/App.jsx";
let c = fs.readFileSync(p, "utf8");
const lines = c.split("\n");
// Fix merchant block indentation
lines[123] = "          <Route";
lines[127] = '                <DashboardLayout variant="merchant" />';
lines[128] = "              </ProtectedRoute>";
lines[129] = "            }";
// Fix admin block indentation
lines[139] = "          <Route";
lines[143] = '                <DashboardLayout variant="admin" />';
lines[144] = "              </ProtectedRoute>";
lines[145] = "            }";
fs.writeFileSync(p, lines.join("\n"));
console.log("Line 124:", JSON.stringify(lines[123]));
console.log("Line 129:", JSON.stringify(lines[128]));
console.log("Line 140:", JSON.stringify(lines[139]));
console.log("Line 145:", JSON.stringify(lines[144]));
