// A merchant must be able to upload their OWN picture of each payment brand, and
// have it shown on the checkout method picker.
//
//   node scripts/testPaymentLogos.mjs
//
// THE BUG THIS PROTECTS AGAINST
//
// The checkout method picker draws each channel from a coloured chip carrying its
// initial, because it cannot assume a merchant has the brand's artwork. That
// fallback is fine and must stay - but it means a store that HAS the real bKash
// wordmark cannot show it.
//
// The fix is a store-level map of channel -> hosted image URL. That is a
// contract between six places, and every one of them can rot silently:
//
//   - the MODEL's key set (does it accept bkash? does it reject nonsense?)
//   - the API's validation and merge (does saving bkash delete nagad?)
//   - the CLOUDINARY hosting (is a data URL ever stored as one?)
//   - the client's channel list (which slots does the Theme tab draw?)
//   - the Theme tab component (can the merchant reach the control?)
//   - the CHECKOUT (does it prefer the mark, and keep the fallback?)
//
// None of these fails loudly. A logo that saves and never appears looks exactly
// like a merchant who forgot to upload one.
//
// THE TWO INVARIANTS WORTH NAMING
//
// 1. CLOSED KEY SET. Unlike Store.categoryImages - keyed by a category NAME, so
//    it must accept keys the app cannot predict - this map is keyed by a channel
//    the app already enumerates. An open key space here means a typo leaves an
//    orphan image on the document forever, growing every public storefront
//    payload, read by nothing.
//
// 2. MERGE, NOT REPLACE. The client uploads ONE channel per request. A plain
//    assignment in the controller would mean saving the bKash mark silently
//    deleted the other three - and the merchant would only find out at checkout,
//    on a payment row, with a customer waiting.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/* read() resolves against the backend package root (this file is in
   backend/scripts, so the helper's own ../ gets us to backend/). The client is a
   sibling of backend/, hence the extra .. on those. */
const read = (rel) =>
  fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const { PAYMENT_METHODS, PAYMENT_LOGO_CHANNELS } = await import(
  '../src/utils/constants.js'
);

const beConstSrc = read('src/utils/constants.js');
const modelSrc = read('src/models/Store.js');
const controllerSrc = read('src/controllers/storeController.js');
const clientConstSrc = read('../client/src/utils/constants.js');
const serviceSrc = read('../client/src/services/storeService.js');
const pickerSrc = read(
  '../client/src/components/storefront/PaymentLogoPicker.jsx',
);
const themeSrc = read('../client/src/pages/store/ThemeBuilder.jsx');
const checkoutSrc = read('../client/src/pages/customer/Checkout.jsx');
const css = read('../client/src/index.css');

// --- 1. One source of truth for "which channels exist" ----------------------
console.log('--- the channel list is derived, not written out ---');

check(
  'PAYMENT_LOGO_CHANNELS is derived from PAYMENT_METHODS (not a hand-written copy)',
  /PAYMENT_LOGO_CHANNELS\s*=\s*PAYMENT_METHODS\.filter\(/.test(beConstSrc),
);
check(
  'and cash is excluded - there is no bKash-style artwork for a banknote glyph',
  !PAYMENT_LOGO_CHANNELS.includes('cod'),
  PAYMENT_LOGO_CHANNELS.join(', '),
);
check(
  'every channel is a real payment method, so a slot cannot exist for one checkout does not offer',
  PAYMENT_LOGO_CHANNELS.every((c) => PAYMENT_METHODS.includes(c)),
);
check(
  'and every online method has a slot (no channel is silently unbranded)',
  PAYMENT_METHODS.filter((m) => m !== 'cod').every((c) =>
    PAYMENT_LOGO_CHANNELS.includes(c),
  ),
);
check(
  'the client derives the same list from its own ONLINE_PAYMENT_CHANNELS',
  /PAYMENT_LOGO_CHANNELS\s*=\s*ONLINE_PAYMENT_CHANNELS/.test(clientConstSrc),
);

// --- 2. The model keeps a CLOSED key set ------------------------------------
console.log('\n--- the stored map only accepts real channels ---');

check(
  'the Store model has a paymentLogos field',
  /paymentLogos:\s*\{/.test(modelSrc),
);
check(
  'it is a plain Object, NOT a Mongoose Map',
  /paymentLogos:\s*\{\s*\n\s*type:\s*Object/.test(modelSrc) &&
    !/paymentLogos:\s*\{\s*\n\s*type:\s*Map/.test(modelSrc),
  'a Map serialises to {} without flattenMaps - the logos would ship as nothing, silently',
);
check(
  'it defaults to an empty object, so a store predating the feature is valid',
  /paymentLogos:[\s\S]{0,160}?default:\s*\(\)\s*=>\s*\(\{\}\)/.test(modelSrc),
);
check(
  'the setter DROPS keys outside the allowed list',
  /paymentLogos:[\s\S]*?if \(!PAYMENT_LOGO_CHANNELS\.includes\(key\)\) continue;/.test(
    modelSrc,
  ),
  'otherwise a typo leaves an orphan image nothing ever reads',
);
check(
  'the model imports the SHARED list rather than spelling the channels out',
  /PAYMENT_LOGO_CHANNELS,/.test(modelSrc),
);
check(
  'and it drops empty values, so a cleared logo cannot linger as an empty string',
  /paymentLogos:[\s\S]*?if \(!image\) continue;/.test(modelSrc),
);
// --- 3. The API validates, MERGES, and hosts --------------------------------
console.log('\n--- the API refuses junk, merges partial updates, hosts the image ---');

check(
  'updateMyStore handles paymentLogos',
  /req\.body\?\.paymentLogos !== undefined/.test(controllerSrc),
);
check(
  'an unknown channel is a 400 that names the valid ones',
  /!PAYMENT_LOGO_CHANNELS\.includes\(key\)[\s\S]{0,220}?HttpError\(\s*400/.test(
    controllerSrc,
  ),
  'a silent drop would leave the merchant watching an "upload succeeded" over a blank box',
);
check(
  'a non-object payload is refused too',
  /Array\.isArray\(incoming\)[\s\S]{0,140}?400/.test(controllerSrc),
);
check(
  'it MERGES onto the existing map - saving one channel cannot delete the others',
  /const logos = \{ \.\.\.\(store\.paymentLogos \|\| \{\}\) \};/.test(controllerSrc),
  'THIS is the bug: a plain assignment wipes the other three logos',
);
check(
  'and writes the merged map back',
  /store\.paymentLogos = logos;/.test(controllerSrc),
);
check(
  'every entry goes through hostImage, so a base64 data URL is never stored',
  /paymentLogos[\s\S]{0,3000}?await hostImage\(/.test(controllerSrc),
);
check(
  'the Cloudinary folder and publicId are per-CHANNEL, so two logos cannot overwrite each other',
  /storeFolder\(store\._id, 'payment-logo'\)/.test(controllerSrc) &&
    /publicIdFor\(store\._id, 'payment-logo', key\)/.test(controllerSrc),
);
check(
  'a replaced logo deletes the old asset instead of orphaning it in Cloudinary',
  /if \(hosted === logos\[key\]\) continue;[\s\S]{0,140}?await removeImage\(logos\[key\]\)/.test(
    controllerSrc,
  ),
);
check(
  'clearing ONE channel deletes just that key',
  /else delete logos\[key\];/.test(controllerSrc),
  '"Remove" on bKash is not "remove every logo"',
);
check(
  'the save invalidates the storefront cache, so checkout sees it immediately',
  /paymentLogos[\s\S]{0,6000}?invalidateStore\(store\._id\)/.test(controllerSrc),
);

// --- 4. The merchant can actually reach the control ------------------------
console.log('\n--- the Theme tab exposes a slot per channel ---');

check(
  'the client service can set (and clear) one channel',
  /export const setPaymentLogo = async \(channel, file, storeId\)/.test(serviceSrc),
);
check(
  'it sends ONE channel per request, which is what makes the server merge matter',
  /paymentLogos:\s*\{\s*\[channel\]:\s*dataUrl\s*\}/.test(serviceSrc),
);
check(
  'and it reuses the SHARED image pipeline (trim + downscale), not a private copy',
  /setPaymentLogo[\s\S]{0,400}?imageToDataUrl\(file, 256\)/.test(serviceSrc),
);
check(
  'the picker iterates the shared channel list, so a new channel gets a slot',
  /PAYMENT_LOGO_CHANNELS\.map\(/.test(pickerSrc),
);
check(
  'it reads what the store actually has saved, for every channel',
  /store\?\.paymentLogos \|\| \{\}/.test(pickerSrc),
);
check(
  'the picker offers a Remove only when there IS something to remove',
  /uploaded \? \([\s\S]{0,400}?Remove/.test(pickerSrc),
);
check(
  'the Theme dashboard renders the picker',
  /<PaymentLogoPicker/.test(themeSrc),
);
check(
  'and the save feeds the panel a refreshed store, so the preview updates',
  /<PaymentLogoPicker[\s\S]{0,220}?onChanged=\{\(updated\) =>/.test(themeSrc),
);

// --- 5. The checkout prefers the mark, and KEEPS the fallback ---------------
console.log('\n--- checkout shows the mark, or the chip it always had ---');

check(
  'the checkout reads the uploaded logo off the store it already loaded',
  /store\?\.paymentLogos\?\.\[method\]/.test(checkoutSrc),
);
check(
  'and renders it as an image when there is one',
  /pay-method__logo--image/.test(checkoutSrc),
);
check(
  'the original coloured chip is still there for every channel without a logo',
  /PAYMENT_METHOD_COLORS\[method\]/.test(checkoutSrc),
);
check(
  'cash keeps its banknote glyph',
  /PAYMENT_METHODS\.COD/.test(checkoutSrc),
);
check(
  'the uploaded image is decorative - the channel name is already in the row beside it',
  /<img src=\{store\.paymentLogos\[method\]\} alt="" \/>/.test(checkoutSrc),
  'alt="" avoids announcing the same word twice in one row',
);

// --- 6. The two tiles must not drift apart ---------------------------------
console.log('\n--- the checkout chip and the Theme preview stay identical ---');

/* These two rules live far apart in one stylesheet and describe different pages,
   so they are written separately on purpose. That makes drift possible, and a
   drift is invisible: the merchant approves artwork at one size and sees it
   drawn at another. So the properties that decide the box are compared. */
const chipRule = css.match(/^\.pay-method__logo \{([\s\S]*?)\n\}/m)?.[1] || '';
const previewRule = css.match(/^\.pay-logo__mark \{([\s\S]*?)\n\}/m)?.[1] || '';

for (const prop of [
  'width: 34px',
  'height: 34px',
  'border-radius: 8px',
  'display: inline-flex',
]) {
  check(
    `the Theme preview tile matches the checkout chip: ${prop}`,
    chipRule.includes(prop) && previewRule.includes(prop),
  );
}

check(
  'an uploaded mark is drawn with contain, never cover',
  /\.pay-method__logo--image img \{[\s\S]*?object-fit:\s*contain/.test(css),
  'cover crops a wide wordmark - "bKash" loses its last letter',
);
check(
  'the uploaded mark sits on white, not on the saturated brand chip',
  /\.pay-method__logo--image \{\s*\n\s*background:\s*#fff/.test(css),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);