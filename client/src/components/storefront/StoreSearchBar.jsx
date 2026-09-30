import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * The storefront's prominent search.
 *
 * The search used to be a plain <input type="search"> sharing a flex row with
 * the category <select> - it was the same visual weight as a filter, not like
 * the main way into a catalogue. It is now a large, centred field with live
 * suggestions, because on a phone it is the only control big enough to aim at
 * and the only one that can be used without first opening a menu.
 *
 * SUGGESTED TAGS ARE DERIVED, NOT HARDCODED. A fixed list like "Milk, Eggs,
 * Lay's" would be advertising products this store may not stock - dead tags on
 * a grocery that sells only hardware are worse than no tags. So the tags come
 * from this store's own catalogue: its categories first (the broadest things it
 * sells), topped up with product names. Always relevant, never a lie.
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
const MAX_TAGS = 6;

export default function StoreSearchBar({
  products = [],
  value,
  onChange,
  inputRef,
  resultCount,
  placeholder = 'Search this store…',
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const listId = useId();

  const term = value.trim().toLowerCase();

  /* What the dropdown offers. Categories are included as well as products, so
     "fresh" can surface a "Fresh Vegetables" shelf that no single item spells
     out. */
  const suggestions = useMemo(() => {
    if (!term) return [];

    const scored = [];
    const seen = new Set();

    const consider = (label, kind) => {
      const text = String(label || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      const score = scoreMatch(text, term);
      if (score === -1) return;
      seen.add(key);
      scored.push({ label: text, kind, score });
    };

    products.forEach((p) => consider(p.name, 'product'));
    products.forEach((p) => consider(p.category, 'category'));

    scored.sort((a, b) => a.score - b.score || a.label.length - b.label.length);
    return scored.slice(0, MAX_SUGGESTIONS);
  }, [products, term]);

  /* The tag row under the field. See the note at the top of this file for why
     these are derived rather than fixed. */
  const suggestedTags = useMemo(() => {
    const out = [];
    const seen = new Set();

    const push = (value) => {
      const text = String(value || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(text);
    };

    products.forEach((p) => push(p.category));
    products.forEach((p) => push(p.name));

    return out.slice(0, MAX_TAGS);
  }, [products]);
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

  const choose = (label) => {
    onChange(label);
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
        choose(suggestions[activeIndex].label);
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
                  choose(s.label);
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

      {/* Tags double as a shortcut and as a hint of what this store sells. */}
      {suggestedTags.length ? (
        <div className="store-search__tags">
          <span className="store-search__tags-label">Popular</span>
          <div className="store-search__tags-row">
            {suggestedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="store-search__tag"
                onClick={() => choose(tag)}
                aria-pressed={value === tag}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
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
