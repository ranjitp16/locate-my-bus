// Provider-neutral map adapter contract.
//
// MapPage.tsx talks to this surface exclusively — no SDK type leaks
// into application code. Swapping providers (Azure → Mapbox → Leaflet)
// is a matter of writing a new implementation alongside azureAdapter.ts
// and pointing the page at it.
//
// The shape mirrors what /view-map actually does today: lifecycle,
// style swap (used by the gear popover), camera animation (used to
// recenter on the pinned bus), and an id-addressable marker registry
// (used by the live-vehicle poller). New methods only get added when
// the page genuinely needs them.

export type LatLng = { lat: number; lng: number };

export type MapAdapterInit = {
  center: LatLng;
  zoom: number;
  /** Provider-specific style identifier (e.g. Azure 'road', 'night'…). */
  style: string;
  language?: string;
};

export type MarkerInit = {
  id: string;
  position: LatLng;
  /** Raw HTML/SVG markup rendered inside the marker container. */
  html: string;
  onClick?: () => void;
};

export type MarkerUpdate = {
  position?: LatLng;
  html?: string;
};

export type CameraMove = {
  center?: LatLng;
  zoom?: number;
  animate?: boolean;
};

export interface MapAdapter {
  /** Resolves once the underlying map is ready to accept markers/style changes. */
  init(container: HTMLElement, opts: MapAdapterInit): Promise<void>;
  dispose(): void;

  setStyle(style: string): void;
  getStyle(): string;

  setCamera(opts: CameraMove): void;
  getZoom(): number;

  addMarker(opts: MarkerInit): void;
  updateMarker(id: string, opts: MarkerUpdate): void;
  removeMarker(id: string): void;
  hasMarker(id: string): boolean;
  listMarkerIds(): string[];
}
