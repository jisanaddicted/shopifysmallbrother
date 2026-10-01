import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { productPath } from '../../utils/constants';

/**
 * The storefront's prominent search.
 *
 * The search used to be a plain <input type="search"> sharing a flex row with
 * the category <select> - it was the same visual weight as a filter, not like
 * the main way into a catalogue. It is now a large, centred field with live
 * suggestions, because on a phone it is the only control big enough to aim at
 * and the only one that can be used without first opening a menu.
 *
 * SUGGESTIONS ARE DERIVED, NOT HARDCODED. A fixed list like "Milk, Eggs,
 * Lay's" would be advertising products this store may not stock - dead tags on
 * a grocery that sells only hardware are worse than no tags. So the suggestions
 * come from this store's own catalogue: its categories as well as its product
 * names, so "fresh" can surface a "Fresh Vegetables" shelf that no single item
 * spells out. Always relevant, never a lie.
 *
 * There used to be a "Popular" row of the same derived strings as permanent
 * chips under the field. It is gone. Those chips repeated the category list the
 * category slider above already shows - on the storefront the two sat close
 * enough together to be the same control drawn twice, and on a category page
 * they listed that one category and its products, which is what the page is
 * already showing. Typing still brings up the same strings, ranked and
 * filtered, which is when a suggestion is actually wanted.
 */

/**
 * Ranks a candidate string against a search term. Lower is better.
 *
 * A word-start match outranks a mid-word one, because "eg" should offer
 * "Eggs" and "Bagels" before "Vinegar". Ties break on how early the match
 * sits, so the shortest sensible suggestion wins.
 */
function scoreMatch(text, term) {
  const haystack = String(text || '').toLowerCase();
  const at = haystack.indexOf(term);
  if (at === -1) return -1;
  const isWordStart = at === 0 || /\s/.test(haystack[at - 1]);
  return (isWordStart ? 0 : 100) + at;
}

const MAX_SUGGESTIONS = 6;

export default function StoreSearchBar({
  products = [],
  value,
  onChange,
  inputRef,
  resultCount,
  placeholder = 'Search this store…',
  /* The store's slug, so a product suggestion can be a LINK rather than a
     filter. Without it the component still works - it just falls back to the old
     "drop the name in the box" behaviour - which is what a page that has no
     slug should get. */
  slug,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const listId = useId();
  const navigate = useNavigate();

  const term = value.trim().toLowerCase();

  /* What the dropdown offers. Categories are included as well as products, so
     "fresh" can surface a "Fresh Vegetables" shelf that no single item spells
     out. */
  const suggestions = useMemo(() => {
    if (!term) return [];

    const scored = [];
    const seen = new Set();

    const consider = (label, kind, id = null) => {
      const text = String(label || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      const score = scoreMatch(text, term);
      if (score === -1) return;
      seen.add(key);
      /* The id rides along so choosing the row can GO somewhere. A product
         suggestion used to carry nothing but its name, which is why it could
         only ever set the search box - see `choose`. */
      scored.push({ label: text, kind, id, score });
    };

    products.forEach((p) => consider(p.name, 'product', p._id || p.id));
    products.forEach((p) => consider(p.category, 'category'));

    scored.sort((a, b) => a.score - b.score || a.label.length - b.label.length);
    return scored.slice(0, MAX_SUGGESTIONS);
  }, [products, term]);

  // A new query means the old highlighted row is meaningless - and can be out
  // of range, which would leave aria-activedescendant pointing at nothing.
  useEffect(() => {
    setActiveIndex(-1);
  }, [term]);

  // The list is a popup: it closes on outside click and on Escape.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  /* What choosing a suggestion DOES.
   *
   * A PRODUCT takes the shopper to that product. It used to only drop the name
   * into the box and let whatever was on screen filter itself, which reads
   * correctly on Theme 1 - the grid narrows as you type, so the product you
   * tapped appears under your finger - and does nothing on Theme 2. There the
   * pane shows ONE node's products, so tapping a suggestion set a term the pane
   * could not match and answered "nothing here matches": search looked broken in
   * precisely the theme that has a tree to navigate instead of a grid to scan.
   *
   * A CATEGORY still filters, deliberately: a category is not a page, and on
   * Theme 2 a product's `category` is a plain string rather than a node in the
   * tree, so there is nothing reliable to navigate to. Filtering is the honest
   * behaviour - and the tree pane offers a way back out when it finds nothing.
   */
  const choose = (suggestion) => {
    const id = suggestion.id;

    if (suggestion.kind === 'product' && id && slug) {
      setOpen(false);
      setActiveIndex(-1);
      navigate(productPath(slug, id));
      return;
    }

    onChange(suggestion.label);
    setOpen(false);
    setActiveIndex(-1);
    inputRef?.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!suggestions.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      // -1 % n is -1, so going up from "nothing highlighted" lands on the LAST
      // row rather than the one before it.
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      // Only swallow Enter when a row is actually highlighted - otherwise the
      // key must still be able to submit the form this input might sit in.
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        /* The whole suggestion, not just its label: the keyboard path has to
           reach the product exactly as a click does. */
        choose(suggestions[activeIndex]);
      }
    }
  };

  const showList = open && Boolean(term);

  return (
    <section className="store-search" ref={wrapRef}>
      <div className="store-search__field">
        <svg
          className="store-search__icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>

        <input
          ref={inputRef}
          type="search"
          className="store-search__input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          /* Only while the popup actually exists. Pointing at an id that is not
             in the DOM is technically tolerated, but a screen reader announcing
             a listbox it cannot find is not something to hand a shopper. */
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeIndex >= 0
              ? `${listId}-opt-${activeIndex}`
              : undefined
          }
          autoComplete="off"
        />

        {value ? (
          <button
            type="button"
            className="store-search__clear"
            onClick={() => {
              onChange('');
              setOpen(false);
              inputRef?.current?.focus();
            }}
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>

      {/* The live suggestions. Announced as a listbox so the arrow-key
          navigation below is the pattern a screen reader already knows. */}
      {showList ? (
        <ul className="store-search__list" id={listId} role="listbox">
          {suggestions.length ? (
            suggestions.map((s, i) => (
              <li
                key={`${s.kind}-${s.label}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`store-search__option${
                  i === activeIndex ? ' is-active' : ''
                }`}
                // mousedown, not click: the input must not blur first, or the
                // list unmounts and the click never lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span>{s.label}</span>
                <span className="store-search__kind">{s.kind}</span>
              </li>
            ))
          ) : (
            <li className="store-search__empty">
              Nothing matches “{value.trim()}”
            </li>
          )}
        </ul>
      ) : null}

      {/* Announced politely rather than shown: the grid below changes as you
          type, and a sighted shopper sees that immediately. */}
      <p className="store-search__count" role="status" aria-live="polite">
        {term && typeof resultCount === 'number'
          ? `${resultCount} product${resultCount === 1 ? '' : 's'} found`
          : ''}
      </p>
    </section>
  );
}
