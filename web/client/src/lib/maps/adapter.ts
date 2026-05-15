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

export type StopPoint = {
  id: string;
  position: LatLng;
  name?: string;
  code?: string;
  /** GTFS arrival time, e.g. "07:45:00". May exceed 24h for post-midnight trips. */
  arrivalTime?: string;
  /** True iff the stop is wheelchair accessible (GTFS wheelchair_boarding = '1'). */
  accessible?: boolean;
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

  /**
   * Draw a polyline along the given lat/lng path with a translucent base
   * stroke and an animated dashed overlay indicating direction of travel.
   * Replaces any previous route. Implementations should keep the line
   * aligned with the underlying map projection as the user pans/zooms.
   */
  drawRoute(points: LatLng[]): void;

  /** Remove the current route polyline (if any). No-op if none is drawn. */
  clearRoute(): void;

  /**
   * Replace the current set of stop markers with the given list. Each
   * stop renders as a small dot with a click-to-open popup showing the
   * provided metadata (name, scheduled arrival, accessibility flag…).
   */
  updateStops(stops: StopPoint[]): void;

  /** Remove all stop markers. No-op if none are drawn. */
  clearStops(): void;

  /**
   * Show (or move) the user's location as a pulsing dot. Passing `null`
   * removes it.
   */
  setUserLocation(pos: LatLng | null): void;

  /**
   * Draw a walking-path polyline (user → nearest stop, typically) with
   * a distinct colour from the bus route. Replaces any previous walk
   * path.
   */
  drawWalkRoute(points: LatLng[]): void;

  /** Remove the walking-path polyline (if any). No-op if none is drawn. */
  clearWalkRoute(): void;
}
