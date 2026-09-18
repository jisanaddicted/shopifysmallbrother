import { useEffect } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { pinIcon } from './AddressPickerMap';
import { MAP } from '../../utils/constants';
import { distanceBetween, formatDistance, timeAgo } from '../../utils/formatters';

/** Accepts { lat, lng } or [lat, lng]; returns null when unusable. */
function toPoint(value) {
  if (!value) return null;

  const lat = Array.isArray(value) ? Number(value[0]) : Number(value.lat);
  const lng = Array.isArray(value) ? Number(value[1]) : Number(value.lng);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Fits both pins on screen, but only when the positions actually change. */
function FitBounds({ points }) {
  const map = useMap();
  const key = points.map((point) => point.join(',')).join('|');

  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], MAP.DEFAULT_ZOOM + 2);
    }
    // `key` is the stable signal; `points` is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

/**
 * Read-only tracking map, shared by the customer tracker and the rider console.
 *
 * <DeliveryMap customerLocation={{ lat, lng }} riderLocation={{ lat, lng }} />
 */
export default function DeliveryMap({
  customerLocation,
  riderLocation,
  riderLabel = 'Rider',
  height = 420,
  showEta = true,
}) {
  const customer = toPoint(customerLocation);
  const rider = toPoint(riderLocation);

  const points = [customer, rider]
    .filter(Boolean)
    .map((point) => [point.lat, point.lng]);

  const center = points[0] || MAP.DEFAULT_CENTER;
  const remaining = showEta ? distanceBetween(rider, customer) : null;

  return (
    <div className="map-wrap">
      {(remaining !== null || riderLocation?.at) && (
        <div className="map-banner">
          {remaining !== null ? (
            <span>
              <strong>{formatDistance(remaining)}</strong> away
            </span>
          ) : null}
          {riderLocation?.at ? (
            <span className="muted">updated {timeAgo(riderLocation.at)}</span>
          ) : null}
        </div>
      )}

      <MapContainer
        center={center}
        zoom={MAP.DEFAULT_ZOOM}
        style={{ height }}
        scrollWheelZoom
      >
        <TileLayer url={MAP.TILE_URL} attribution={MAP.ATTRIBUTION} />

        {customer && (
          <Marker position={[customer.lat, customer.lng]} icon={pinIcon('customer')}>
            <Popup>Drop-off point</Popup>
          </Marker>
        )}

        {rider && (
          <Marker position={[rider.lat, rider.lng]} icon={pinIcon('rider')}>
            <Popup>{riderLabel}</Popup>
          </Marker>
        )}

        {customer && rider && (
          <Polyline
            positions={[
              [rider.lat, rider.lng],
              [customer.lat, customer.lng],
            ]}
            pathOptions={{ color: '#2563eb', weight: 4, dashArray: '6 10' }}
          />
        )}

        <FitBounds points={points} />
      </MapContainer>

      {!rider && (
        <p className="map-status">
          Waiting for the rider's first GPS ping…
        </p>
      )}
    </div>
  );
}