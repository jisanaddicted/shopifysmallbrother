import { useState } from 'react';
import { STORE_RIDER_STATUS, STORE_RIDER_STATUS_LABELS } from '../../utils/constants';

/* What somebody can be invited as, in the order a merchant should meet them.
   The value is what the API stores; the label is what the merchant reads. */
const INVITE_ROLES = [
  { value: 'rider', label: 'Rider' },
  { value: 'admin', label: 'Store admin' },
];

/* One badge tone per invitation state: green for somebody working, amber for an
   invitation still sitting in their inbox, blue for declined or removed. The
   CONTRAST of these pills is measured rather than eyeballed - see `.badge--*`
   in index.css. */
const STATUS_TONES = {
  [STORE_RIDER_STATUS.ACTIVE]: 'success',
  [STORE_RIDER_STATUS.PENDING]: 'warn',
};

const toneFor = (status) => STATUS_TONES[status] || 'info';

/**
 * The Team panel: invite somebody to this store, and manage who is on it.
 *
 * The invite is ONE row - username, role, send - rather than the two-step it
 * used to be (choose a role, search for a username, wait for a profile card,
 * then press a second button on that card to invite). Two steps for one action
 * is one step too many, and the middle one was a full round trip to a database
 * this project reaches over a network, so the panel felt broken while it was
 * working. The API already takes a username and answers 404 for one it does not
 * know, so the lookup was never needed to make the invite safe - it only ever
 * delayed it.
 *
 * The "@" is a PREFIX INSIDE the field rather than a character floating between
 * controls: it decorates the eye, so it is hidden from a screen reader, which
 * gets the input's own label instead.
 *
 * The roster is a real <table> with real headers. A cell that needs to lay its
 * contents out in a row puts a `.table__cell` wrapper INSIDE the <td>, never
 * `display: flex` on the cell itself - see the note on `.table__cell`.
 */
export default function TeamPanel({
  store,
  riders = [],
  busy = false,
  error = '',
  onInvite,
  onRemove,
}) {
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState(INVITE_ROLES[0].value);

  /* The field clears only on SUCCESS. A rejected invite - an unknown username,
     or an account that does not run this store - must not also destroy what
     the merchant typed in order to try again. */
  const submit = async (event) => {
    event.preventDefault();
    const who = handle.trim();
    if (!who || busy) return;
    if (await onInvite(who, role)) setHandle('');
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Team</h2>
        <span className="muted small">
          Invite anyone on the platform by their username.
        </span>
      </div>

      <form className="invite-form" onSubmit={submit}>
        {/* One control group. The "@" is part of the field rather than a sibling
            of it, so the thing a merchant types into and the thing that marks
            what the value is cannot drift apart. */}
        <div className="invite-form__field">
          <span className="invite-form__prefix" aria-hidden="true">
            @
          </span>
          <input
            className="invite-form__input"
            type="text"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="sam.rider"
            aria-label="Username to invite"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
          />
        </div>

        <div className="invite-form__role">
          <label className="sr-only" htmlFor="team-invite-role">
            Role
          </label>
          <select
            id="team-invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {INVITE_ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="btn btn-primary invite-form__submit"
          disabled={busy || handle.trim().length === 0}
        >
          Send Invitation
        </button>
      </form>

      {/* Stands in for the profile card the old two-step showed, and does the job
          the dropdown's label could not: say what each role actually does. */}
      <p className="muted small invite-form__hint">
        {role === 'admin'
          ? 'A store admin manages this store’s orders, products and storefront.'
          : 'A rider takes deliveries and sees the orders assigned to them.'}
      </p>

      {error ? (
        <p className="alert alert--warn" role="alert">
          {error}
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="table team-table">
          {/* Named, because the panel is per store and a screen reader moving
              between two stores' pages hears "People on this store's team"
              twice with nothing to tell them apart. `sr-only` still puts it in
              the accessibility tree, which is the point of a caption. */}
          <caption className="sr-only">
            People on {store?.name || 'this store'}&apos;s team
          </caption>
          <thead>
            <tr>
              {/* Header alignment follows the cell it labels, so a heading never
                  sits over data that starts somewhere else. */}
              <th scope="col">Rider</th>
              <th scope="col">Status</th>
              <th scope="col" className="table__th--actions">
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {riders.map((link) => {
              /* `link.status` is the INVITATION state (pending/active/...), never
                 a delivery state. When a row arrives without it - a stale cache,
                 a partial payload - show "invitation sent" rather than a bare
                 "undefined" badge. */
              const status = link.status || STORE_RIDER_STATUS.PENDING;
              const person = link.rider || {};
              const who =
                person.username || person.name || person.email || 'rider';

              return (
                <tr key={link._id || link.id}>
                  <td>
                    <div className="table__cell">
                      <strong>@{who}</strong>
                      {person.name || person.email ? (
                        <span className="muted small">
                          {person.name || person.email}
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td>
                    <span className={`badge badge--${toneFor(status)}`}>
                      {STORE_RIDER_STATUS_LABELS[status] || status}
                    </span>
                  </td>

                  <td>
                    <div className="table__cell table__cell--actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => onRemove(person._id || person.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {riders.length === 0 ? (
              <tr>
                <td colSpan={3} className="team-table__empty">
                  Nobody is on this team yet. Invite somebody above and they will
                  appear here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}