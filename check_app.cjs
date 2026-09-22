const fs = require('fs');
const c = fs.readFileSync('client/src/App.jsx', 'utf8');
const lines = c.split('\n');

let badLine = -1;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.includes('Side-navbar shell instead of the top navbar') || t.includes('*/}')) {
    badLine = i;
    break;
  }
}

console.log('Bad line index:', badLine);
if (badLine >= 0) {
  console.log('Line content:', JSON.stringify(lines[badLine]));
  console.log('Line before:', JSON.stringify(lines[badLine - 1]));
  console.log('Line after:', JSON.stringify(lines[badLine + 1]));
}
