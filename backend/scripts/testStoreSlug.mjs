// The store SLUG on a rename: does the public URL (/s/<slug>) follow the store
// name, and when does it deliberately refuse to?
//
//   node scripts/testStoreSlug.mjs
//
// The bug this protects against is real and was shipped: PATCH /stores/mine
// only ever touched the slug when the request body carried one, and the
// merchant dashboard never sent one - so a merchant could rename their store
// all day and the URL never moved. The fix made the slug follow the name, but
// "follows the name" is only correct while the slug was never claimed:
// overwriting a merchant's chosen address would break every link they had
// already printed on a menu.
//
// So both halves need protecting:
//   1. an unclaimed slug follows a rename,
//   2. a claimed slug does NOT.
//
// "Claimed" is the stored flag Store.slugIsCustom - NOT a comparison of the slug
// against the name. An earlier version decided it by comparing, and that was
// wrong in the direction that matters: the live store is named "Ronex mart" but
// carries the slug `joes-pizza` from before it was renamed, so the comparison
// read it as hand-chosen and its link could never move again. A comparison
// cannot tell a deliberate choice from a stale one; a flag can, because only
// the dashboard ever sets it.
//
// Everything is namespaced with a timestamp and removed in a finally block, so
// it is safe to run against the development database.
import mongoose from 'mongoose';
import fs from 'node:fs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Store from '../src/models/Store.js';
import { slugify } from '../src/utils/slug.js';

const TAG = `slugtest-${Date.now()}`;

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`,
    );
  }
};

/** uniqueSlug(), against the real collection. */
const nextFreeSlug = async (base, excludeId) => {
  const root = slugify(base);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await Store.exists({ slug: candidate, _id: { $ne: excludeId } });
    if (!taken) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
};

/**
 * The slug block from updateMyStore, extracted verbatim so the test exercises
 * the shipped DECISION rather than a paraphrase of it. Copied rather than
 * imported because it is inline in a long handler that needs an authed request;
 * the assertions at the end pin this copy to the original.
 */
async function applySlugRule(store, { name, slug, slugLocked } = {}) {
  const previousName = store.name;

  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) throw new Error('A store needs a name.');
    store.name = clean;
  }

  const explicitSlug = String(slug ?? '').trim();
  const unclaimed = !store.slugIsCustom || slugLocked === false;

  if (explicitSlug) {
    if (slugify(explicitSlug, '') !== store.slug) {
      store.slug = await nextFreeSlug(explicitSlug, store._id);
    }
    store.slugIsCustom = slugLocked !== false;
  } else if (name !== undefined && unclaimed) {
    store.slug = await nextFreeSlug(store.name, store._id);
    store.slugIsCustom = false;
  }

  await store.save();
  return store.slug;
}

/** A store as the dashboard creates it: name + the slug the system derived. */
const makeStore = async (name) =>
  Store.create({ name, slug: slugify(name), owner: new mongoose.Types.ObjectId() });

/** The client's preview helper, copied from client/src/utils/constants.js. */
const slugifyName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

async function main() {
  await connectDB();
  console.log(`\nStore slug / rename test (${TAG})\n`);

  const created = [];
  try {
    // --- 1. An automatic slug follows a rename ----------------------------
    console.log('--- an automatic slug follows the name ---');
    {
      const store = await makeStore(`Slice & Dice ${TAG}`);
      created.push(store._id);
      const after = await applySlugRule(store, { name: `Slice & Dice Deli ${TAG}` });
      check('renaming moves the slug', after, slugify(`Slice & Dice Deli ${TAG}`));
    }

    // A blank name is still refused - the rule must not become a way to save an
    // empty store just because it also rewrites the slug.
    {
      const store = await makeStore(`Blank Name ${TAG}`);
      created.push(store._id);
      const before = store.slug;
      let threw = false;
      try {
        await applySlugRule(store, { name: '   ' });
      } catch {
        threw = true;
      }
      check('a blank name is still refused', threw, true);
      check('and the slug survived the refusal', store.slug, before);
    }

    // --- 2. A slug the merchant claimed does NOT follow a rename ---------
    console.log('\n--- a claimed slug is left alone ---');
    {
      const store = await makeStore(`Chosen Slug ${TAG}`);
      created.push(store._id);
      store.slug = `my-custom-address-${TAG}`;
      store.slugIsCustom = true;
      await store.save();

      const after = await applySlugRule(store, {
        name: `Totally Different Name ${TAG}`,
      });
      check('renaming leaves a claimed slug alone', after, `my-custom-address-${TAG}`);
      check('but the name still changed', store.name, `Totally Different Name ${TAG}`);
    }

    /* The real-world case this whole design exists for, found by looking at the
       live data: the seeded store is named "Ronex mart" but still carries the
       slug `joes-pizza` from before it was renamed. Its slug matches NEITHER
       its old name nor its new one, so the earlier "does the slug match the
       name?" comparison read it as hand-chosen and the slug could never move
       again - the merchant renames, saves, and nothing happens. That is the
       bug being fixed, reproduced exactly. */
    console.log('\n--- a store renamed before this feature existed recovers ---');
    {
      const store = await makeStore(`Joe's Pizza ${TAG}`);
      created.push(store._id);
      // Put it in the state the live store is actually in: renamed, slug left
      // behind, never claimed.
      store.name = `Ronex mart ${TAG}`;
      store.slug = `joes-pizza-${TAG}`;
      await store.save();

      const after = await applySlugRule(store, {
        name: `Ronex Super Mart ${TAG}`,
        slug: slugifyName(`Ronex Super Mart ${TAG}`),
        slugLocked: false,
      });
      check(
        'renaming it now moves the link',
        after,
        slugifyName(`Ronex Super Mart ${TAG}`),
      );
      check('and it is recorded as derived, not claimed', store.slugIsCustom, false);
    }

    // --- 3. The lock flag is what the client uses to claim a slug ---------
    console.log('\n--- a claimed slug wins and sticks ---');
    {
      const store = await makeStore(`Explicit ${TAG}`);
      created.push(store._id);

      const after = await applySlugRule(store, {
        name: `Explicit Renamed ${TAG}`,
        slug: `chosen-by-hand-${TAG}`,
        slugLocked: true,
      });
      check('the sent slug is used, not the derived one', after, `chosen-by-hand-${TAG}`);
      check('and it is recorded as claimed', store.slugIsCustom, true);

      // ...so a later rename leaves it alone, even with no slug sent at all.
      const later = await applySlugRule(store, { name: `Explicit Again ${TAG}` });
      check('and it stays put on the next rename', later, `chosen-by-hand-${TAG}`);

      // ...until the merchant hands it back ("use store name"), which is what
      // slugLocked:false means.
      const released = await applySlugRule(store, {
        name: `Explicit Third ${TAG}`,
        slug: slugifyName(`Explicit Third ${TAG}`),
        slugLocked: false,
      });
      check('handing it back to the name works', released, slugifyName(`Explicit Third ${TAG}`));
      check('and it is recorded as derived again', store.slugIsCustom, false);
    }

    // A blank slug is not a request to erase the address.
    {
      const store = await makeStore(`Blank Slug ${TAG}`);
      created.push(store._id);
      const after = await applySlugRule(store, {
        name: `Blank Slug Renamed ${TAG}`,
        slug: '   ',
      });
      check(
        'a blank slug falls back to the name rule',
        after,
        slugify(`Blank Slug Renamed ${TAG}`),
      );
    }

    // --- 4. Collisions are still resolved ---------------------------------
    console.log('\n--- a collision does not overwrite the other store ---');
    {
      const name = `Collide ${TAG}`;
      const first = await makeStore(name);
      created.push(first._id);
      check('the first store takes the plain slug', first.slug, slugify(name));

      // A rename onto a taken address must be deflected, never allowed to take
      // an address another store already answers on.
      const second = await makeStore(`${name} Two`);
      created.push(second._id);

      const forced = await nextFreeSlug(name, second._id);
      check('a rename onto a taken address is deflected', forced, `${slugify(name)}-2`);

      const untouched = await Store.findById(first._id).lean();
      check('the first store still owns its address', untouched.slug, slugify(name));
    }

    // --- 5. The controller still contains this exact rule -----------------
    console.log('\n--- the shipped controller matches the rule under test ---');
    {
      const src = fs.readFileSync(
        new URL('../src/controllers/storeController.js', import.meta.url),
        'utf8',
      );

      // The test above runs a COPY. These assertions are what stop that copy
      // from quietly diverging from the controller it claims to protect.
      check(
        'updateMyStore writes to a real document, not the projected plain object',
        /const store = await Store\.findById\(entry\.store\._id\);/.test(src),
        true,
      );
      check(
        'an explicit slug in the body still wins',
        /const explicitSlug = String\(slug \?\? ''\)\.trim\(\);/.test(src),
        true,
      );
      check(
        'a rename still goes through uniqueSlug, so collisions are handled',
        /store\.slug = await uniqueSlug\(store\.name/.test(src),
        true,
      );
      check(
        'the claim flag is read from the body, so the client decides',
        /req\.body\?\.slugLocked === false/.test(src),
        true,
      );
      check(
        'and recorded on the store',
        /store\.slugIsCustom = req\.body\?\.slugLocked !== false;/.test(src),
        true,
      );
      check(
        'unclaimed defaults off the stored flag, not a name comparison',
        /const unclaimed = !store\.slugIsCustom \|\| req\.body\?\.slugLocked === false;/.test(
          src,
        ),
        true,
      );
      // The regression this design replaced: matching the slug against the
      // previous name to decide "is it hand-set?" is what froze the live
      // "Ronex mart" store on `joes-pizza`.
      check(
        'the old name-comparison test is NOT what gates the auto-update',
        /slugify\(previousName, ''\) [!=]==/.test(src),
        false,
      );
    }

    console.log(`\n${pass} passed, ${fail} failed\n`);
  } finally {
    // Only the stores this run created. The seeded storefront is never touched.
    if (created.length) await Store.deleteMany({ _id: { $in: created } });
    await disconnectDB();
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nSlug test crashed:', err.message);
  try {
    await disconnectDB();
  } catch {
    /* the connection may never have opened */
  }
  process.exit(1);
});
