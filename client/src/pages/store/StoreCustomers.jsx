import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import {
  ROUTES,
  STORE_CUSTOMER_STATUS,
  STORE_CUSTOMER_STATUS_LABELS,
} from '../../utils/constants';
import { formatCurrency, formatDateTime, initials } from '../../utils/formatters';

/**
 * Everyone who shops at this store, as a full page in the side rail.
 *
 * This replaces the customer table that used to sit halfway down "My store".
 * It was not a shortage of space that moved it - the same data was on screen
 * before - it was that a list of people is something a merchant returns to and
 * searches, not something they scroll past once while looking for the team
 * panel.
 *
 * The two right-hand columns are why this is a page and not a card: "orders" and
 * "amount spent" are how a merchant ranks customers, and the server rolls both
 * up per customer so the ordering can be a real sort rather than a guess.
 */

// Customers arrive newest-first from the server, which is the useful default,
// but "biggest spender" is the question this page exists to answer, so it gets
// a real sort instead of being left to the API.
const SORTS = [
  { value: 'recent', label: 'Recently joined' },
  { value: 'spent', label: 'Most spent' },
  { value: 'orders', label: 'Most orders' },
  { value: 'name', label: 'Name A–Z' },
];

/** The name to show: their chosen name, else the handle, else the email. */
const displayName = (customer) =>
  customer?.name || customer?.username || customer?.email || 'Customer';

/** Read-only stars. The same glyph and colour as the customer's own rating
 *  control, minus the affordances: a merchant cannot rate a customer, so these
 *  must not look pressable or pretend to respond to a click. */
function StarRating({ value }) {
  const stars = [1, 2, 3, 4, 5];

  return (
    <span className="stars stars--readonly" aria-hidden="true">
      {stars.map((star) => (
        <span
          key={star}
          className={`stars__star${star <= value ? ' is-on' : ''}`}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/** What a review is about, for the link back to the delivery it describes.
 *
 *  The server sends `order` as a bare id, not a populated object, so this has to
 *  cope with either - and with neither, where the review is still worth reading
 *  even though it cannot be clicked through to. */
const orderIdOf = (review) => review?.order?._id || review?.order || '';

export default function StoreCustomers() {
  const { stores: sessionStores } = useAuth();
  const [entries, setEntries] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* What customers said about this store's deliveries.

     `GET /stores/:id/reviews` already existed and already had a service method,
     but nothing ever called it - a customer could rate a delivery on their order
     page and the merchant had nowhere to read it. The ratings were written,
     stored and served; they were just invisible. This is the screen that reads
     them.

     Reviews are loaded ALONGSIDE the customer list rather than on demand: they
     are the reason a merchant opens this tab, so waiting behind a second click
     would make the page look like it had no reviews at all. */
  const [reviews, setReviews] = useState([]);
  const [reviewAverage, setReviewAverage] = useState(null);
  const [distribution, setDistribution] = useState([]);
  const [reviewError, setReviewError] = useState('');

  // The store switcher, as on the orders board - the list is always one store's.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mine = await storeService.listMyMerchantStores();
        if (!alive) return;
        const list = Array.isArray(mine) ? mine : mine?.stores || [];
        setStores(list);
        setStoreId(
          (current) => current || list[0]?.store?._id || list[0]?._id || '',
        );
      } catch {
        if (!alive) return;
        const fallback = (sessionStores || []).map((entry) => ({
          store: entry.store || entry,
        }));
        setStores(fallback);
        setStoreId((current) => current || fallback[0]?.store?._id || '');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionStores]);

  const load = useCallback(async () => {
    if (!storeId) {
      setEntries([]);
      setReviews([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setReviewError('');
    try {
      const data = await storeService.listStoreCustomers(storeId);
      setEntries(data?.customers || []);
    } catch (err) {
      setError(err.message || 'Could not load your customers.');
      setEntries([]);
    } finally {
      setLoading(false);
    }

    /* Reviews are fetched separately and their failure is deliberately NOT
       allowed to clear `error` or blank the customer table above. A store whose
       reviews endpoint is unhappy must still get to see their customers; the
       reviews simply show their own message. One broken panel should not take
       the working one down with it. */
    try {
      const reviewData = await storeService.listStoreReviews(storeId);
      setReviews(reviewData?.reviews || []);
      setReviewAverage(
        Number.isFinite(reviewData?.average) ? reviewData.average : null,
      );
      setDistribution(reviewData?.distribution || []);
    } catch (err) {
      setReviews([]);
      setReviewAverage(null);
      setDistribution([]);
      setReviewError(err.message || 'Could not load your reviews.');
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();

    const filtered = entries.filter((entry) => {
      if (!needle) return true;
      const customer = entry.customer || {};
      return [customer.name, customer.email, customer.username, customer.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    const sorted = [...filtered];
    if (sort === 'spent') {
      sorted.sort((a, b) => (b.spent || 0) - (a.spent || 0));
    } else if (sort === 'orders') {
      sorted.sort((a, b) => (b.orders || 0) - (a.orders || 0));
    } else if (sort === 'name') {
      sorted.sort((a, b) =>
        displayName(a.customer).localeCompare(displayName(b.customer)),
      );
    } else {
      // "Recently joined" - the server already returns them newest first, so
      // this is just the stable default when the list is unsorted.
      sorted.sort(
        (a, b) =>
          new Date(b.joinedAt || 0).getTime() -
          new Date(a.joinedAt || 0).getTime(),
      );
    }
    return sorted;
  }, [entries, term, sort]);

  /* The reviews, matched against the search box.

     The SAME `term` narrows the customers and the reviews, because a merchant
     looking for one person is looking for both halves of that person at once -
     "who was the one who complained about the cold bag?" should find the row and
     the sentence, not just the row. */

    /* Which customer's reviews are on show.
     null = the whole store's reviews, the default. Clicking a row's button sets
     this to that customer and the panel below narrows to them.

     Keyed on the customer ID, never on the name. `Review.customerName` is a
     SNAPSHOT taken when the review was written (see the Review model), so two
     people can share a name, and a customer who has since renamed would stop
     matching their own history if we compared strings. The id is the only join
     that cannot quietly come apart. */
  const [focusedCustomerId, setFocusedCustomerId] = useState('');
  const reviewsRef = useRef(null);

  /* Reviews grouped by customer id, for the per-row count and the panel.
     Built once per `reviews` change rather than filtered inside the map, so
     typing in the search box does not re-partition the list on every keystroke. */
  const reviewsByCustomer = useMemo(() => {
    const grouped = new Map();
    for (const review of reviews) {
      const key = String(review.customer?._id || review.customer || '');
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(review);
    }
    return grouped;
  }, [reviews]);

  const focusedCustomer = useMemo(() => {
    if (!focusedCustomerId) return null;
    const entry = entries.find(
      (item) => String(item.customer?._id || item.id) === focusedCustomerId,
    );
    return entry ? displayName(entry.customer) : null;
  }, [focusedCustomerId, entries]);

  /* Clicking a row scrolls the panel into view. Without it the button appears to
     do nothing on a long customer list - the reviews it just filtered are below
     the fold, and the merchant is left clicking the same row again. */
  const showCustomerReviews = (customerId) => {
    setFocusedCustomerId((current) => (current === customerId ? '' : customerId));
    reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const visibleReviews = useMemo(() => {
    const needle = term.trim().toLowerCase();
    let list = focusedCustomerId
      ? reviewsByCustomer.get(focusedCustomerId) || []
      : reviews;

    if (!needle) return list;

    return list.filter((review) =>
      [review.customerName, review.comment]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [reviews, term, focusedCustomerId, reviewsByCustomer]);

  const exportCsv = () => {
    const header = [
      'Name',
      'Email',
      'Phone',
      'Location',
      'Orders',
      'Amount spent',
      'Reviews',
      'Average rating',
      'Review notes',
    ];
    const rows = visible.map((entry) => {
      const customer = entry.customer || {};
      const theirReviews =
        reviewsByCustomer.get(String(customer._id || entry.id || '')) || [];
      const rated = theirReviews
        .map((review) => Number(review.rating))
        .filter((value) => Number.isFinite(value));
      const average = rated.length
        ? Math.round(
            (rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10,
          ) / 10
        : '';

      return [
        displayName(customer),
        customer.email || '',
        customer.phone || '',
        entry.location || '',
        entry.orders || 0,
        entry.spent || 0,
        theirReviews.length,
        average,
        // Newlines inside a comment would break the row, and the exporter's
        // quoting only doubles quotes - it does not escape line breaks.
        theirReviews
          .map((review) => review.comment)
          .filter(Boolean)
          .join(' | ')
          .replace(/\s*\r?\n\s*/g, ' '),
      ];
    });

    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [header, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\r\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalSpent = visible.reduce((sum, entry) => sum + (entry.spent || 0), 0);

  if (loading) return <LoadingSpinner label="Loading customers…" />;

  return (
    <div className="customers">
      <header className="customers__head">
        <h1 className="customers__title">Customers</h1>

        <div className="customers__head-actions">
          {stores.length > 1 ? (
            <select
              className="input"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              aria-label="Choose a store"
            >
              {stores.map((entry) => {
                const store = entry.store || entry;
                return (
                  <option key={store._id} value={store._id}>
                    {store.name}
                  </option>
                );
              })}
            </select>
          ) : null}

          <select
            className="input"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort customers"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={exportCsv}
            disabled={!visible.length}
          >
            Export
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={load}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="orders__filters">
        <div className="orders__search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
          />
        </div>
      </div>

      {visible.length ? (
        <>
          <div className="table-wrap">
            <table className="table customers__table">
              <thead>
                <tr>
                  <th>Customer name</th>
                  <th>Email</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="orders__num">Orders</th>
                  <th className="orders__num">Amount spent</th>
                  <th>Reviews</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const customer = entry.customer || {};
                  const blocked = entry.status === STORE_CUSTOMER_STATUS.BLOCKED;
                  const customerId = String(customer._id || entry.id || '');
                  const theirReviews = reviewsByCustomer.get(customerId) || [];
                  const isFocused = focusedCustomerId === customerId;

                  return (
                    <tr key={customer._id || entry.id}>
                      <td>
                        <span className="customers__who">
                          <span className="avatar avatar--sm" aria-hidden="true">
                            {initials(displayName(customer))}
                          </span>
                          <span>
                            <strong>{displayName(customer)}</strong>
                            {customer.username ? (
                              <span className="muted small block">
                                @{customer.username}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="muted small">
                        {customer.email || '—'}
                      </td>
                      <td className="muted small">
                        {entry.location || '—'}
                      </td>
                      <td>
                        <span
                          className={`badge badge--${blocked ? 'danger' : 'success'}`}
                        >
                          {STORE_CUSTOMER_STATUS_LABELS[entry.status] ||
                            'Active'}
                        </span>
                      </td>
                      <td className="orders__num">{entry.orders || 0}</td>
                      <td className="price orders__num nowrap">
                        {formatCurrency(entry.spent || 0)}
                      </td>

                      {/* Opens the panel below filtered to this person. A
                          toggle, not a one-way door: clicking the row you are
                          already reading returns to the whole store's reviews,
                          so the button never becomes a dead end. */}
                      <td>
                        {theirReviews.length ? (
                          <button
                            type="button"
                            className={`btn btn-outline btn-sm${
                              isFocused ? ' is-active' : ''
                            }`}
                            onClick={() => showCustomerReviews(customerId)}
                            aria-expanded={isFocused}
                            aria-controls="customer-reviews"
                          >
                            {isFocused ? 'Showing' : 'Reviews'}{' '}
                            <span className="customers__count">
                              {theirReviews.length}
                            </span>
                          </button>
                        ) : (
                          <span className="muted small">None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted small orders__count">
            {visible.length} customer{visible.length === 1 ? '' : 's'} ·{' '}
            {formatCurrency(totalSpent)} spent in total
          </p>
        </>
      ) : (
        <div className="card empty">
          <p className="muted">
            {entries.length
              ? 'No customers match that search.'
              : 'No customers yet. Anyone who signs up or orders from your store shows up here.'}
          </p>
        </div>
      )}

      {/* --- Customer reviews -------------------------------------------------
          Placed BELOW the customer table on purpose. These are what customers
          wrote about deliveries, not properties of a person, so they read as a
          separate stream of their own - and the table above is already six
          columns wide. */}
      <section
        className="customers__reviews"
        id="customer-reviews"
        ref={reviewsRef}
      >
        <header className="customers__reviews-head">
          <h2 className="panel__title">
            {focusedCustomerId
              ? `Reviews from ${focusedCustomer || 'this customer'}`
              : 'Customer reviews'}
          </h2>
          <p className="panel__subtitle">
            {focusedCustomerId
              ? 'Filtered to one customer. Showing every review they have left.'
              : reviewAverage === null
                ? 'Ratings customers left on their deliveries.'
                : `Average ${reviewAverage} out of 5 across ${reviews.length} review${reviews.length === 1 ? '' : 's'}.`}
          </p>
        </header>

        {/* The way back out. A filtered list with no way to unfilter is the kind
            of thing a merchant reports as "the reviews vanished". */}
        {focusedCustomerId ? (
          <div className="customers__reviews-focus">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFocusedCustomerId('')}
            >
              ← Show all customers
            </button>
          </div>
        ) : null}

        {reviewError ? (
          <p className="alert alert--danger">{reviewError}</p>
        ) : null}

        {/* The 1-5 histogram, straight from the server's `distribution`.
            Without it a 4.2 average hides the only thing a merchant acts on: that
            two people were badly let down among a lot of happy ones. */}
        {distribution.length && reviews.length && !focusedCustomerId ? (
          <ul className="customers__histogram">
            {distribution.map((bucket) => (
              <li key={bucket.rating}>
                <span className="muted small">{bucket.rating}★</span>
                <span className="customers__histogram-bar">
                  <span
                    style={{
                      width: `${
                        reviews.length
                          ? (bucket.count / reviews.length) * 100
                          : 0
                      }%`,
                    }}
                  />
                </span>
                <span className="muted small">{bucket.count}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {visibleReviews.length ? (
          <ul className="customers__review-list">
            {visibleReviews.map((review) => {
              const orderId = orderIdOf(review);
              const author =
                review.customerName || 'A customer of this store';

              return (
                <li key={review._id || review.id} className="customers__review">
                  <div className="customers__review-head">
                    <span className="avatar avatar--sm" aria-hidden="true">
                      {initials(author)}
                    </span>
                    <span>
                      <strong>{author}</strong>
                      <span className="muted small block">
                        {formatDateTime(review.createdAt)}
                      </span>
                    </span>
                    <span className="customers__review-rating">
                      <StarRating value={review.rating} />
                      <span className="sr-only">
                        {review.rating} out of 5 stars
                      </span>
                    </span>
                  </div>

                  {review.comment ? (
                    <p className="customers__review-text">{review.comment}</p>
                  ) : (
                    <p className="muted small">
                      No note left, just the stars.
                    </p>
                  )}

                  {/* The MERCHANT order detail, never /track/:orderId - the
                      same rule StoreRiderAnalytics follows. /track/:orderId is the
                      buyer's page, carrying the confirmation and rating controls
                      that are none of the store's to press. */}
                  {orderId ? (
                    <Link
                      className="customers__review-order"
                      to={ROUTES.MERCHANT_ORDER_DETAIL.replace(
                        ':orderId',
                        orderId,
                      )}
                    >
                      View the delivery #
                      {String(orderId).slice(-6).toUpperCase()}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="card empty">
            <p className="muted">
              {reviewError
                ? ''
                : focusedCustomerId
                  ? `${focusedCustomer || 'This customer'} has not left a review.`
                  : reviews.length
                    ? 'No reviews match that search.'
                    : 'No reviews yet. Customers can rate a delivery once they confirm it arrived on their order page.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
