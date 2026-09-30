import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import VariantMatrix from '../../components/store/VariantMatrix';
import { useAuth } from '../../context/AuthContext';
import productService from '../../services/productService';
import menuService from '../../services/menuService';
import { statusOf, tracksInventory } from '../../utils/catalog';
import {
  PRODUCT_STATUS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_VALUES,
  productEditPath,
} from '../../utils/constants';
import { truncate } from '../../utils/formatters';

const EMPTY_FORM = {
  name: '',
  price: '',
  category: '',
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
  // Held apart from `form` for the same reason ProductManager does it: the
  // matrix re-renders on every keystroke, and dragging the whole form with it
  // would remount inputs under the merchant mid-edit.
  const [options, setOptions] = useState([]);
  const [variants, setVariants] = useState([]);
  const [saving, setSaving] = useState(false);
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
      return undefined;
    }

    let active = true;
    setCategoriesLoading(true);

    menuService
      .getStoreCategories(storeId)
      .then((next) => {
        if (active) setCategories(next);
      })
      .catch(() => {
        if (active) setCategories([]);
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

              <span className="media__add" aria-hidden="true">+</span>
            </div>

            <label className="field">
              <span>Image URL</span>
              <input
                type="url"
                name="image"
                value={form.image}
                onChange={handleChange}
                placeholder="https://example.com/photo.jpg"
              />
            </label>

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
                    setForm((prev) => ({ ...prev, category: '' }));
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
