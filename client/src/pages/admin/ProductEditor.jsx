import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import VariantMatrix from '../../components/store/VariantMatrix';
import { useAuth } from '../../context/AuthContext';
import productService from '../../services/productService';
import { buildCategoryTree, flattenTreeForSelect } from '../../utils/categoryTree';
import menuService from '../../services/menuService';
import { statusOf, tracksInventory } from '../../utils/catalog';
import {
  PRODUCT_STATUS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_VALUES,
  THEME,
  productEditPath,
} from '../../utils/constants';
import { truncate } from '../../utils/formatters';
import { imageToDataUrl, validateImageFile } from '../../utils/imageFile';

const EMPTY_FORM = {
  name: '',
  price: '',
  category: '',
  // The Theme 2 tree node, as a node id. Kept BESIDE `category` rather than
  // replacing it: the two belong to different themes and are set independently,
  // so a store can switch layouts without a single product being rewritten.
  categoryId: '',
  stock: '',
  rack: '',
  shelf: '',
  image: '',
  description: '',
  status: PRODUCT_STATUS.ACTIVE,
  trackInventory: true,
  productType: '',
  vendor: '',
  collections: [],
};

/**
 * One product, edited.
 *
 * The list (ProductManager) is deliberately dumb: it knows how to show
 * products and how to delete one, and nothing else. Everything that writes a
 * product lives here, so "open a product and change it" and "add a product"
 * are literally the same form with a different starting state - which is the
 * only way they cannot drift apart and start validating different things.
 *
 * `productId` is read from the route. There is no id at all on the create
 * route, and the literal string "new" is never sent to the API - the route
 * table matches /products/new ahead of /products/:productId, so "new" can
 * only ever be the empty case.
 */
export default function ProductEditor({ basePath }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { stores } = useAuth();

  // "Are we creating or editing?" decided by whether an id was captured, NOT
  // by comparing it to the string "new".
  //
  // The two routes are `/products/new` (no parameter at all) and
  // `/products/:productId`, so on the create route `useParams()` returns an
  // EMPTY object and `productId` is `undefined` - there is no "new" string to
  // compare against. Testing for the absence of an id is therefore the only
  // check that is true for the create route and false for every real product,
  // including the impossible case of a product whose id happens to be "new".
  const isNew = !productId;

  // Every catalogue editor only ever sees the store(s) they run - the same
  // session list ProductManager loads from, so a product can never be filed
  // into a store this account does not run.
  const memberStores = useMemo(
    () => (stores || []).map((entry) => entry.store).filter(Boolean),
    [stores],
  );
  const [storeId, setStoreId] = useState('');

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [form, setForm] = useState(EMPTY_FORM);
  /* The store's categories, for the Category dropdown. Read from the same
     endpoint the theme panel edits, so the two can never disagree about what
     exists - see menuService.getStoreCategories.

     Held apart from `form` because it is loaded data rather than something the
     merchant is typing: it arrives on its own, and refetching it must not
     disturb a half-filled form. */
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  /* Which layout this store shows, and its Theme 2 tree.
   *
   * The theme arrives in the SAME response as the flat category list, so on
   * Theme 1 - every store that has not deliberately switched - deciding which
   * picker to render costs nothing extra. Only a Theme 2 store pays for a second
   * request, and only for the tree it actually needs. See
   * menuService.getStoreCategories. */
  const [storeTheme, setStoreTheme] = useState('theme1');
  const [treeNodes, setTreeNodes] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  // Held apart from `form` for the same reason ProductManager does it: the
  // matrix re-renders on every keystroke, and dragging the whole form with it
  // would remount inputs under the merchant mid-edit.
  const [options, setOptions] = useState([]);
  const [variants, setVariants] = useState([]);
  const [saving, setSaving] = useState(false);
  /* Is a photo being read/decoded right now?

     A picked file is turned into a data URL on a canvas before it can be sent,
     which on a large phone photo is long enough that a merchant would click the
     button again - and the second read would race the first, leaving whichever
     finished last as the photo, which is not necessarily the one they wanted.
     The flag disables both controls while a read is in flight. */
  const [imageBusy, setImageBusy] = useState(false);

  /* Is `form.image` a data URL rather than a stored one?

     A photo the merchant just picked lives in the form as base64 until the
     product is saved and the API has handed back a real URL. Two consequences:
     the URL box must not render it (it is unreadable there), and the form must
     not clear it on a failed save, because there is nothing on the server to
     fall back to. */
  const isLocalImage = form.image.startsWith('data:');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Default the target store to the primary one from the session.
  useEffect(() => {
    if (memberStores.length && !storeId) {
      setStoreId(String(memberStores[0]._id || memberStores[0].id));
    }
  }, [memberStores, storeId]);

  /**
   * Load the store's categories for the dropdown.
   *
   * Keyed on `storeId` rather than fetched once, because a member who runs
   * several stores can switch this product between them from the Store picker
   * above - and two shops do not share a category list. Changing store
   * therefore reloads the options.
   *
   * The response also says which THEME the store is on, so the same read decides
   * which picker this form renders. A Theme 2 store then needs its tree, which
   * is a second request - deliberately not fired for a Theme 1 store, which
   * would pay for a tree it will never show.
   *
   * A failed load is NOT surfaced as a form error and does not block saving.
   * The dropdown degrades to whatever it already had, and because the current
   * category is always rendered as an option (see `categoryOptions`), a product
   * can still be opened, read and re-saved with its category intact while the
   * category list is unavailable. Blocking the whole form on a failed
   * supplementary read would trade a working product for a dead dropdown.
   */
  useEffect(() => {
    if (!storeId) {
      setCategories([]);
      setTreeNodes([]);
      return undefined;
    }

    let active = true;
    setCategoriesLoading(true);

    menuService
      .getStoreCategories(storeId)
      .then(({ theme, categories: next }) => {
        if (!active) return;

        setStoreTheme(theme);
        setCategories(next);

        // Only a Theme 2 store has a tree to read. Doing it here rather than in
        // a second effect keyed on the theme keeps the two loads in one place
        // and one `active` flag, so a store switch cannot land the tree of the
        // shop the merchant just left in the picker for the new one.
        if (theme === THEME.TWO) {
          setTreeLoading(true);

          return menuService
            .loadCategoryTree(storeId)
            .then((rows) => {
              if (active) setTreeNodes(rows);
            })
            .catch(() => {
              if (active) setTreeNodes([]);
            })
            .finally(() => {
              if (active) setTreeLoading(false);
            });
        }

        setTreeNodes([]);
        return undefined;
      })
      .catch(() => {
        if (!active) return;
        setCategories([]);
        setTreeNodes([]);
      })
      .finally(() => {
        if (active) setCategoriesLoading(false);
      });

    // `active` rather than checking an id after the fact: this effect can be
    // torn down mid-flight by a store switch, and a late response would
    // otherwise land in the state of the store the merchant has moved on from.
    return () => {
      active = false;
    };
  }, [storeId]);

  /**
   * The tree, flattened into one `<option>` per node.
   *
   * Every node appears, not just the leaves. A product can be filed on a
   * BRANCH as well as on a leaf, and a shopper reaching that branch sees its
   * products - so hiding branches would make those products unreachable by
   * filing rather than by accident.
   */
  const treeOptions = useMemo(
    () => flattenTreeForSelect(buildCategoryTree(treeNodes)),
    [treeNodes],
  );

  /**
   * The option the tree picker is held on.
   *
   * The same rule as `selectedCategory` above, and for the same reason: a
   * `<select>` whose value matches no option renders blank and would save `''`,
   * silently unfiling the product. The product's stored node is therefore always
   * kept in the list - see the note on that field.
   */
  const selectedTreeNode = useMemo(() => {
    const current = String(form.categoryId || '').trim();
    if (!current) return '';

    return (
      treeOptions.find((row) => row.id === current)?.id ||
      /* Not in the list - a node deleted in the Theme tab while this form was
         open, or a tree that failed to load. Keep it selectable so saving does
         not quietly unfile the product. */
      current
    );
  }, [treeOptions, form.categoryId]);

  /**
   * The category options actually rendered.
   *
   * The product's CURRENT category is always in this list, even when the server
   * did not return it. That is not belt-and-braces, it is the difference
   * between editing a product and silently unfiling it:
   *
   *   - a `<select>` whose `value` matches none of its `<option>`s renders
   *     blank, so `form.category` on the next save would be `''`;
   *   - the stored category being absent from the list is entirely possible -
   *     it was filed under a different store, the read failed, or the merchant
   *     deleted that category in the Theme tab while this form was open.
   *
   * So the current name is appended when missing, and the comparison is
   * case-insensitive to agree with the server's own rule (see listCategories):
   * a product filed as "drinks" under a curated "Drinks" is one section, and
   * must not appear as two entries or as none.
   */
  const categoryOptions = useMemo(() => {
    const names = categories
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean);

    const current = form.category.trim();
    if (current && !names.some((name) => name.toLowerCase() === current.toLowerCase())) {
      names.push(current);
    }

    return names;
  }, [categories, form.category]);

  /**
   * The option the select is held on, which is the stored category resolved
   * against the list.
   *
   * Normalised rather than passed through so the control can only ever hold a
   * value that is actually one of its options. A product stored as "drinks"
   * under a curated "Drinks" is held on "Drinks" - the spelling the merchant
   * chose - so saving that untouched form files the product under the name
   * their storefront heading actually uses, instead of quietly reintroducing
   * the stray capitalisation.
   */
  const selectedCategory = useMemo(() => {
    const current = form.category.trim();
    if (!current) return '';

    return (
      categoryOptions.find((name) => name.toLowerCase() === current.toLowerCase()) || current
    );
  }, [categoryOptions, form.category]);

  /**
   * Load the product into the form.
   *
   * Every field is stringified on the way in, because a number input holds a
   * string and React warns (and silently misbehaves) if one arrives as a
   * number. The matrix rows keep their `_id` so the server recognises a save
   * as an edit rather than a delete-and-recreate - which is what keeps carts
   * and receipts pointing at these rows valid.
   */
  const loadProduct = useCallback(async (id) => {
    setLoading(true);
    setError('');

    try {
      const loaded = await productService.getProductById(id);
      setProduct(loaded);
      setForm({
        name: loaded?.name || '',
        price: String(loaded?.price ?? ''),
        category: loaded?.category || '',
        // The Theme 2 node, if this product is filed on one. Kept as-is even
        // when the store is on Theme 1: it is a different field from
        // `category`, and clearing it because a different picker is showing
        // would quietly unfile the product from a tree the merchant may switch
        // back to in a moment.
        categoryId: loaded?.categoryId || '',
        stock: String(loaded?.stock ?? ''),
        rack: loaded?.rack || '',
        shelf: loaded?.shelf || '',
        image: loaded?.image || '',
        description: loaded?.description || '',
        status: statusOf(loaded),
        trackInventory: tracksInventory(loaded),
        productType: loaded?.productType || '',
        vendor: loaded?.vendor || '',
        collections: [...(loaded?.collections || [])],
      });
      setOptions(
        (loaded?.options || []).map((option) => ({
          name: option?.name || '',
          values: [...(option?.values || [])],
        })),
      );
      setVariants(
        (loaded?.variants || []).map((variant) => ({
          _id: variant?._id || variant?.id,
          optionValues: { ...(variant?.optionValues || {}) },
          price: variant?.price ?? '',
          compareAtPrice: variant?.compareAtPrice ?? '',
          sku: variant?.sku || '',
          stock: variant?.stock ?? '',
          image: variant?.image || '',
          enabled: variant?.enabled !== false,
        })),
      );

      if (loaded?.store) setStoreId(String(loaded.store));
    } catch (err) {
      setError(err.message || 'Could not load that product.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isNew) return;
    loadProduct(productId);
  }, [isNew, productId, loadProduct]);

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  /* Pick a photo from this machine.

     The file is NOT uploaded here. It is downscaled in the browser and put into
     `form.image` as a data URL, so it is previewed immediately and saved by the
     SAME submit as every other field - one button, no separate "upload then
     save" step that could be half-finished. The API already handles a data URL
     on this field: `hostProductImages` forwards it to Cloudinary and stores the
     URL it gets back (backend/src/controllers/productController.js).

     Until then `form.image` is a local value, which is what `isLocalImage`
     reports, and the form keeps it if the save fails. */
  const handleImagePick = async (event) => {
    const file = event.target.files?.[0];
    // Cleared immediately so picking the SAME file twice in a row still fires a
    // change event - without this, re-picking a rejected image does nothing.
    event.target.value = '';
    if (!file || imageBusy) return;

    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      setNotice('');
      return;
    }

    setImageBusy(true);
    setError('');
    setNotice('');

    try {
      const dataUrl = await imageToDataUrl(file);
      setForm((prev) => ({ ...prev, image: dataUrl }));
      setNotice('Photo added. Press Save to store it on the product.');
    } catch (err) {
      setError(err.message || 'Could not read that image.');
    } finally {
      setImageBusy(false);
    }
  };

  const setCollection = (index, value) =>
    setForm((prev) => ({
      ...prev,
      collections: prev.collections.map((entry, i) => (i === index ? value : entry)),
    }));

  const addCollection = () =>
    setForm((prev) => ({ ...prev, collections: [...prev.collections, ''] }));

  const removeCollection = (index) =>
    setForm((prev) => ({
      ...prev,
      collections: prev.collections.filter((_, i) => i !== index),
    }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!form.name.trim()) {
      setError('A product needs a name.');
      return;
    }

    // A product with a matrix carries its own per-row price and stock, so the
    // headline numbers must not also be sent as though they were the price of
    // the product. They are still required by the schema, so the product price
    // is the seed the matrix defaults from and its stock is left at zero -
    // `totalStock` reads the matrix, so the top-level figure is never shown to
    // a shopper once there are variants.
    const hasMatrix = options.length > 0;

    const payload = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      category: form.category.trim(),

      /* The Theme 2 node, sent on EVERY save - like `category`, and for a
         sharper version of the same reason.

         `undefined` at the server means "leave it alone", and `null` means
         "unfile". So omitting the key would be safe, but sending it explicitly
         is what makes the box above work: if the merchant clears the picker, the
         select holds '', this sends null, and the product comes off the branch.

         Sending it even while the store is on Theme 1 is deliberate. The two
         fields are populated independently, so a merchant who files a product
         under a tree node, switches back to Theme 1 for a while, and later
         returns must find that node untouched. */
      categoryId: selectedTreeNode || null,
      stock: form.stock === '' ? 0 : Number(form.stock),
      rack: form.rack.trim(),
      shelf: form.shelf.trim(),
      image: form.image.trim(),
      description: form.description.trim(),

      // Sent on every save, including when empty. An absent key means "this
      // client does not manage variants", which would leave a merchant unable
      // to delete a matrix they no longer want.
      options: options.map((option) => ({
        name: option.name.trim(),
        values: option.values,
      })),
      variants: variants.map((variant) => ({
        ...(variant._id ? { _id: variant._id } : {}),
        optionValues: variant.optionValues,
        price: variant.price === '' ? 0 : Number(variant.price),
        ...(variant.compareAtPrice === '' || variant.compareAtPrice === undefined
          ? { compareAtPrice: null }
          : { compareAtPrice: Number(variant.compareAtPrice) }),
        stock: variant.stock === '' ? 0 : Number(variant.stock),
        sku: variant.sku || '',
        image: variant.image || '',
        enabled: variant.enabled !== false,
      })),

      // Publishing + organisation. Always sent too, for the same reason: a
      // status the client omits is one the server is told to leave alone, so
      // this form states every one of them explicitly and cannot leave a
      // product stuck in a draft because of a field it forgot to render.
      status: form.status,
      trackInventory: form.trackInventory,
      productType: form.productType.trim(),
      vendor: form.vendor.trim(),
      collections: form.collections.map((entry) => entry.trim()).filter(Boolean),
    };

    // A matrix with no complete rows would save as "no variants" and silently
    // drop the options. Say so rather than accepting it.
    if (hasMatrix && !payload.variants.length) {
      setError('Give each option a name and at least one value, or remove the option.');
      return;
    }

    // A member running several stores must say which one; the backend pins
    // the product for anybody with a single store.
    if (memberStores.length > 1 && storeId) {
      payload.storeId = storeId;
    }

    setSaving(true);

    try {
      if (isNew) {
        const created = await productService.createProduct(payload);
        // Straight to the product just made, so a second change is one click
        // away rather than a trip back through the list.
        navigate(productEditPath(basePath, created._id || created.id), { replace: true });
      } else {
        await productService.updateProduct(productId, payload);
        setNotice(`“${payload.name}” saved.`);
      }
    } catch (err) {
      setError(err.message || 'Could not save that product.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) return;

    try {
      await productService.deleteProduct(productId);
      navigate(basePath, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not delete that product.');
    }
  };

  if (loading) return <LoadingSpinner fullPage label="Loading product…" />;

  const heading = isNew ? 'Add product' : form.name || 'Product';

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link className="crumbs__link" to={basePath}>← Products</Link>
      </nav>

      <header className="page__header">
        <div>
          <h1>{heading}</h1>
          <p className="muted">
            {isNew
              ? 'Add an item to your catalogue. It appears in your shop as soon as you save it.'
              : form.description
                ? truncate(form.description, 90)
                : 'No description yet.'}
          </p>
        </div>

        <div className="button-row">
          {!isNew ? (
            <>
              <Link className="btn btn-outline btn-sm" to={basePath}>
                Back to products
              </Link>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleDelete}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--ok">{notice}</p> : null}

      <form className="editor" onSubmit={handleSubmit}>
        <div className="editor__main">
          <section className="panel">
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Chicken Momo"
                maxLength={120}
                required
                autoFocus={isNew}
              />
            </label>

            <label className="field">
              <span>Description</span>
              <textarea
                name="description"
                rows={4}
                value={form.description}
                onChange={handleChange}
                placeholder="Short text shown on the store card"
              />
            </label>
          </section>

          <section className="panel">
            <h2 className="panel__title">Media</h2>
            <div className="media">
              {form.image ? (
                <span className="media__tile">
                  <img src={form.image} alt="" />
                </span>
              ) : null}

              {/* The upload control itself.

                  This used to be a bare `<span aria-hidden>+</span>`: decorative,
                  not a button, with no file input behind it, so clicking it did
                  nothing at all: the only way to give a product a picture was to paste
                  a URL into the box that used to sit under this tile, and that box
                  is gone now too. Uploading is the only way to set a photo.
                  It is a real `<label>` wrapping a hidden file input, the same shape
                  ThemeBuilder's logo
                  and category pickers already use.

                  A `<label>` rather than a `<button>` because the browser then
                  forwards the click to the input and opens the OS file dialog,
                  which also keeps it keyboard-reachable - a div with an onClick
                  is neither. */}
              <label
                className={`media__add${imageBusy ? ' is-disabled' : ''}`}
                title={form.image ? 'Replace this photo' : 'Upload a photo'}
              >
                {imageBusy ? '...' : form.image ? '↻' : '+'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={imageBusy}
                  onChange={handleImagePick}
                />
              </label>
            </div>

            <div className="button-row">
              <label className="btn btn-outline btn-sm">
                {imageBusy
                  ? 'Uploading...'
                  : form.image
                    ? 'Change photo'
                    : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={imageBusy}
                  onChange={handleImagePick}
                />
              </label>
              {form.image ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => setForm((prev) => ({ ...prev, image: '' }))}
                  disabled={imageBusy}
                >
                  Remove
                </button>
              ) : null}
            </div>

            {isLocalImage ? (
              <p className="muted small">
                Photo ready. Press Save to upload it.
              </p>
            ) : null}
            <p className="muted small">
              The photo shoppers see on the product card. Each option can carry
              its own photo further down, which is what lets a shopper see the
              blue one on the blue button.
            </p>
          </section>

          <VariantMatrix
            options={options}
            setOptions={setOptions}
            variants={variants}
            setVariants={setVariants}
          />
        </div>

        <aside className="editor__side">
          <section className="panel">
            <h2 className="panel__title">Status</h2>

            <label className="field">
              <span>Publishing</span>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
              >
                {PRODUCT_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {PRODUCT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>

            <p className="muted small">
              {form.status === PRODUCT_STATUS.ACTIVE
                ? 'Live in your storefront and buyable.'
                : form.status === PRODUCT_STATUS.DRAFT
                  ? 'Only you can see this. It is not in your storefront and cannot be ordered.'
                  : 'Hidden from your storefront. Kept so past orders still show what was bought.'}
            </p>
          </section>

          <section className="panel">
            <h2 className="panel__title">Inventory</h2>

            <label className="field field--inline">
              <input
                type="checkbox"
                checked={form.trackInventory}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    trackInventory: event.target.checked,
                  }))
                }
              />
              <span>Track inventory for this product</span>
            </label>

            {form.trackInventory ? (
              <div className="field-row">
                <label className="field">
                  <span>Stock</span>
                  <input
                    type="number"
                    name="stock"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={handleChange}
                    placeholder="25"
                  />
                </label>

                <label className="field">
                  <span>Price</span>
                  <input
                    type="number"
                    name="price"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="4.50"
                    required
                  />
                </label>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Price</span>
                  <input
                    type="number"
                    name="price"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="4.50"
                    required
                  />
                </label>

                <p className="muted small">
                  Stock is not counted for this product, so it stays buyable
                  whatever the number above says. Use it for anything made to
                  order.
                </p>
              </>
            )}

            {options.length > 0 ? (
              <p className="muted small">
                This product has options, so the price and stock that matter are
                the ones in the table below - the fields here are only the
                defaults new rows start from.
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="panel__title">Product organization</h2>

            {memberStores.length > 1 ? (
              <label className="field">
                <span>Store</span>
                <select
                  value={storeId}
                  onChange={(event) => {
                    setStoreId(event.target.value);
                    // A category belongs to the store that defines it, so
                    // carrying it across would file the product under a section
                    // of a shop that has never heard of it - and it would not
                    // even be in the list this box now offers. Clearing it here,
                    // rather than in an effect watching `storeId`, also keeps
                    // the automatic store defaulting below (which sets
                    // `storeId` too) from wiping the category that a loaded
                    // product brought with it.
                    setForm((prev) => ({ ...prev, category: '', categoryId: '' }));
                  }}
                >
                  {memberStores.map((store) => (
                    <option key={store._id || store.id} value={store._id || store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {/* ONE category field, showing the picker that matches the store
                active theme. They are not two views of the same thing: Theme 1
                files a product under a heading string, Theme 2 under a node in
                a tree, and a store is on exactly one of them. Showing both would
                ask the merchant to pick between two different answers when only
                one of them changes what their shop looks like. */}
            {storeTheme === THEME.TWO ? (
              <>
                <label className="field">
                  <span>Category</span>
                  {/* The merchant tree, flattened - "Drinks > Cold > Juice" - so
                      a subcategory is never mistaken for a top-level one that
                      happens to share its name. */}
                  <select
                    name="categoryId"
                    value={selectedTreeNode}
                    onChange={handleChange}
                    disabled={
                      (categoriesLoading || treeLoading) && !treeOptions.length
                    }
                  >
                    <option value="">No category</option>
                    {treeOptions.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                    {/* The stored node, if the tree no longer lists it. Without
                        this the select renders blank and saving quietly unfiles
                        the product - see `selectedTreeNode`. */}
                    {selectedTreeNode &&
                    !treeOptions.some((row) => row.id === selectedTreeNode) ? (
                      <option value={selectedTreeNode}>
                        {selectedTreeNode} (no longer in your tree)
                      </option>
                    ) : null}
                  </select>
                </label>

                <p className="muted small">
                  {treeLoading
                    ? 'Loading your categories…'
                    : treeOptions.length === 0
                      ? 'This store has no categories yet. Build one in the Theme tab, then file products under it here.'
                      : 'This product appears under whichever category you pick, on your Theme 2 storefront. Build and rename categories in the Theme tab.'}
                </p>
              </>
            ) : (
              <>
            <label className="field">
              <span>Category</span>
              {/* A picker over the store's real categories rather than a
                  free text box. A category is the storefront's section
                  heading, so typing a near-miss ("drinks", "Drinks", "Drink")
                  used to quietly make three sections that each held a share
                  of the stock and all read the same to a shopper. Choosing
                  from the list is the entire point of curating one in the
                  Theme tab. */}
              <select
                name="category"
                value={selectedCategory}
                onChange={handleChange}
                disabled={categoriesLoading && !categoryOptions.length}
              >
                {/* The blank option is first because a product with no
                    category is perfectly valid - the storefront gathers
                    those under its own "Other items" heading. */}
                <option value="">No category</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <p className="muted small">
              {categoriesLoading
                ? 'Loading your categories…'
                : categoryOptions.length === 0
                  ? 'This store has no categories yet. Create one in the Theme tab, and it becomes a section you can file products under.'
                  : 'Every product filed under a category shows on your storefront as its own section. Add or rename categories in the Theme tab.'}
            </p>
              </>
            )}

            <label className="field">
              <span>Type</span>
              <input
                type="text"
                name="productType"
                value={form.productType}
                onChange={handleChange}
                placeholder="Snack"
              />
            </label>

            <label className="field">
              <span>Vendor</span>
              <input
                type="text"
                name="vendor"
                value={form.vendor}
                onChange={handleChange}
                placeholder="Ronex Foods"
              />
            </label>

            <div className="field">
              <span>Collections</span>
              <div className="vm__chips">
                {form.collections.map((entry, index) => (
                  <span className="vm__chip" key={index}>
                    <input
                      value={entry}
                      maxLength={40}
                      placeholder="Best sellers"
                      aria-label={`Collection ${index + 1}`}
                      onChange={(event) => setCollection(index, event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${entry || 'collection'}`}
                      onClick={() => removeCollection(index)}
                    >
                      ×
                    </button>
                  </span>
                ))}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={addCollection}
                  disabled={form.collections.length >= 25}
                >
                  + collection
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel__title">Where it sits</h2>

            <div className="field-row">
              <label className="field">
                <span>Rack</span>
                <input
                  type="text"
                  name="rack"
                  maxLength={20}
                  value={form.rack}
                  onChange={handleChange}
                  placeholder="A3"
                />
              </label>

              <label className="field">
                <span>Shelf</span>
                <input
                  type="text"
                  name="shelf"
                  maxLength={20}
                  value={form.shelf}
                  onChange={handleChange}
                  placeholder="2"
                />
              </label>
            </div>

            <p className="muted small">
              So staff can find it on a big order. Both parts are optional.
            </p>
          </section>

          <div className="button-row editor__actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Add product' : 'Save'}
            </button>

            <Link className="btn btn-ghost" to={basePath}>
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  );
}
