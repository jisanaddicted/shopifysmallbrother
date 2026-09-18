/**
 * Small spinner used while data loads.
 *
 * <LoadingSpinner />                        inline, medium
 * <LoadingSpinner size="sm" label={null} /> no text
 * <LoadingSpinner fullPage />               centred on an empty screen
 */
export default function LoadingSpinner({
  label = 'Loading…',
  size = 'md',
  fullPage = false,
}) {
  return (
    <div className={`spinner-wrap ${fullPage ? 'spinner-wrap--page' : ''}`}>
      <span className={`spinner spinner--${size}`} aria-hidden="true" />
      {label ? <p className="spinner-label">{label}</p> : null}
    </div>
  );
}
