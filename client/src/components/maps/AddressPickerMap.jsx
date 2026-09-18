import { useEffect, useState } from 'react';
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { MAP } from '../../utils/constants';

/**
 * Leaflet's default marker PNGs break under Vite, so every pin is drawn with
 * an inline divIcon instead - no image files to import.
 *
 * To use the artwork in src/assets/icons (customer-pin.png / rider-bike.png)
 * later, import the file and swap `html` for `<img src={...} />`:
 *
 *   import customerPin from '../../assets/icons/customer-pin.png';
 *   L.divIcon({ className: 'map-pin', html: `<img src="${customerPin}" alt="" />` })
 */
export const pinIcon = (variant = 'customer') =>
  L.divIcon({
    className: `map-pin map-pin--${variant}`,
    html: '<i></i>',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });

/** Turns a map click into the lat/lng the parent cares about. */
function ClickToPick({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng);
    },
  });
  return null;
}

/** Moves the view only when the "use my location" button is pressed. */
function FlyTo({ target }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 16));
  }, [target, map]);

  return null;
}

export default function AddressPickerMap({ value, onChange, height = 340 }) {
  const [status, setStatus] = useState('');
  const [flyTarget, setFlyTarget] = useState(null);

  const hasPoint = Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
  const position = hasPoint ? [value.lat, value.lng] : MAP.DEFAULT_CENTER;

  const pick = (latlng) => {
    setFlyTarget(null);
    onChange?.({
      lat: Number(latlng.lat.toFixed(6)),
      lng: Number(latlng.lng.toFixed(6)),
      source: 'map',
    });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus('This browser cannot read your location.');
      return;
    }

    setStatus('Finding you…');

    navigator.geolocation.getCurrentPosition(
      (result) => {
        const point = {
          lat: Number(result.coords.latitude.toFixed(6)),
          lng: Number(result.coords.longitude.toFixed(6)),
          source: 'gps',
        };
        setFlyTarget(point);
        setStatus('Location found — drag the pin to fine-tune it.');
        onChange?.(point);
      },
      () => setStatus('Location permission denied — drag the pin instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="map-wrap">
      <MapContainer
        center={position}
        zoom={hasPoint ? 16 : MAP.DEFAULT_ZOOM}
        style={{ height }}
        scrollWheelZoom
      >
        <TileLayer url={MAP.TILE_URL} attribution={MAP.ATTRIBUTION} />

        <Marker
          position={position}
          icon={pinIcon('customer')}
          draggable
          eventHandlers={{
            dragend: (event) => pick(event.target.getLatLng()),
          }}
        />

        <ClickToPick onPick={pick} />
        <FlyTo target={flyTarget} />
      </MapContainer>

      <div className="map-tools">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={useMyLocation}
        >
           Use my current location
        </button>
        <span className="map-hint">
          Tap the map or drag the pin to set the drop-off point.
        </span>
      </div>

      {status ? <p className="map-status">{status}</p> : null}

      <p className="map-coords">
        {hasPoint
          ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
          : 'No point selected yet'}
      </p>
    </div>
  );
}