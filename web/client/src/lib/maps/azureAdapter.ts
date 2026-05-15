// Azure Maps SDK v3 implementation of the MapAdapter contract.
// Lazy-imports the SDK + CSS so the rest of the app doesn't pay for
// the ~1.7MB atlas-esm bundle until /view-map is opened.

import type * as atlasType from 'azure-maps-control';
import { proxyAuthOptions, proxyTransformRequest } from '../azureMaps';
import type {
  CameraMove,
  LatLng,
  MapAdapter,
  MapAdapterInit,
  MarkerInit,
  MarkerUpdate,
  StopPoint,
} from './adapter';

type AtlasNs = typeof atlasType;
type AtlasMap = InstanceType<AtlasNs['Map']>;
type AtlasMarker = InstanceType<AtlasNs['HtmlMarker']>;
type AtlasPopup = InstanceType<AtlasNs['Popup']>;

const SVG_NS = 'http://www.w3.org/2000/svg';

export class AzureMapAdapter implements MapAdapter {
  private atlas: AtlasNs | null = null;
  private map: AtlasMap | null = null;
  private readonly markers = new Map<string, AtlasMarker>();
  private readonly elements = new Map<string, HTMLDivElement>();
  // Route polyline state. We draw the route as a plain SVG overlay
  // inside the map's canvas container (instead of fighting MapLibre's
  // line-dasharray, which doesn't animate smoothly via setOptions), and
  // reproject on every `move` event so the path tracks the camera. CSS
  // keyframes (lmb-dash in tokens.css) drive the dash-flow animation.
  private routeSvg: SVGSVGElement | null = null;
  private routeCoords: [number, number][] | null = null;
  private routeMoveHandler: (() => void) | null = null;
  // Stop markers + popups for the current trip. Stored together so
  // clearStops() can dispose both halves cleanly.
  private readonly stopMarkers: { marker: AtlasMarker; popup: AtlasPopup }[] = [];
  // Two independent slots so hover previews coexist with a click-pinned
  // popup. The pinned one stays put while the user hovers other stops;
  // hover-out only dismisses the popup that the cursor brought up.
  private pinnedPopup: AtlasPopup | null = null;
  private hoverPopup: AtlasPopup | null = null;

  async init(container: HTMLElement, opts: MapAdapterInit): Promise<void> {
    const atlas = await import('azure-maps-control');
    await import('azure-maps-control/dist/atlas.min.css');
    this.atlas = atlas;

    const map = new atlas.Map(container, {
      center: toAzurePosition(opts.center),
      zoom: opts.zoom,
      style: opts.style,
      language: opts.language ?? 'en-US',
      authOptions: proxyAuthOptions,
      transformRequest: proxyTransformRequest,
    });

    await new Promise<void>((resolve) => {
      map.events.add('ready', () => resolve());
    });

    this.map = map;
  }

  dispose(): void {
    this.clearRoute();
    this.clearStops();
    this.map?.dispose();
    this.map = null;
    this.atlas = null;
    this.markers.clear();
    this.elements.clear();
  }

  setStyle(style: string): void {
    if (!this.map) return;
    const current = (this.map.getStyle() as { style?: string }).style;
    if (current === style) return;
    this.map.setStyle({ style });
  }

  getStyle(): string {
    return (this.map?.getStyle() as { style?: string })?.style ?? '';
  }

  setCamera(opts: CameraMove): void {
    if (!this.map) return;
    this.map.setCamera({
      center: opts.center ? toAzurePosition(opts.center) : undefined,
      zoom: opts.zoom,
      type: opts.animate ? 'ease' : 'jump',
      duration: opts.animate ? 400 : 0,
    });
  }

  getZoom(): number {
    return this.map?.getCamera().zoom ?? 0;
  }

  addMarker({ id, position, html, onClick }: MarkerInit): void {
    if (!this.map || !this.atlas) return;
    if (this.markers.has(id)) {
      // Replace any stale marker with the same id before adding.
      this.removeMarker(id);
    }
    const wrap = document.createElement('div');
    wrap.dataset.markerId = id;
    wrap.style.cursor = 'pointer';
    wrap.innerHTML = html;
    if (onClick) {
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
    }
    const marker = new this.atlas.HtmlMarker({
      htmlContent: wrap,
      position: toAzurePosition(position),
    });
    this.map.markers.add(marker);
    this.markers.set(id, marker);
    this.elements.set(id, wrap);
  }

  updateMarker(id: string, opts: MarkerUpdate): void {
    const marker = this.markers.get(id);
    if (!marker) return;
    if (opts.position) {
      marker.setOptions({ position: toAzurePosition(opts.position) });
    }
    if (opts.html != null) {
      const el = this.elements.get(id);
      if (el) el.innerHTML = opts.html;
    }
  }

  removeMarker(id: string): void {
    const marker = this.markers.get(id);
    if (!marker || !this.map) return;
    this.map.markers.remove(marker);
    this.markers.delete(id);
    this.elements.delete(id);
  }

  hasMarker(id: string): boolean {
    return this.markers.has(id);
  }

  listMarkerIds(): string[] {
    return Array.from(this.markers.keys());
  }

  drawRoute(points: LatLng[]): void {
    if (!this.map || !points.length) return;
    this.clearRoute();

    const coords: [number, number][] = points.map((p) => [p.lng, p.lat]);
    this.routeCoords = coords;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

    const base = document.createElementNS(SVG_NS, 'path');
    base.setAttribute('fill', 'none');
    base.setAttribute('stroke', 'var(--signal)');
    base.setAttribute('stroke-width', '5');
    base.setAttribute('stroke-opacity', '0.28');
    base.setAttribute('stroke-linecap', 'round');
    base.setAttribute('stroke-linejoin', 'round');
    base.classList.add('lmb-route-base');

    const dash = document.createElementNS(SVG_NS, 'path');
    dash.setAttribute('fill', 'none');
    dash.setAttribute('stroke', 'var(--signal)');
    dash.setAttribute('stroke-width', '3');
    dash.setAttribute('stroke-linecap', 'round');
    dash.setAttribute('stroke-linejoin', 'round');
    dash.setAttribute('stroke-dasharray', '10 8');
    dash.style.animation = 'lmb-dash 1.6s linear infinite';
    dash.classList.add('lmb-route-dash');

    svg.appendChild(base);
    svg.appendChild(dash);

    // Insert under the marker collection so bus markers stay on top.
    const container = this.map.getCanvasContainer();
    const markerContainer = container.querySelector('.marker-collection-container');
    if (markerContainer) {
      container.insertBefore(svg, markerContainer);
    } else {
      container.appendChild(svg);
    }
    this.routeSvg = svg;

    const handler = () => this.updateRouteSvg();
    this.routeMoveHandler = handler;
    this.map.events.add('move', handler);
    this.updateRouteSvg();
  }

  clearRoute(): void {
    if (this.routeMoveHandler && this.map) {
      this.map.events.remove('move', this.routeMoveHandler);
    }
    this.routeMoveHandler = null;
    if (this.routeSvg) {
      this.routeSvg.remove();
      this.routeSvg = null;
    }
    this.routeCoords = null;
  }

  updateStops(stops: StopPoint[]): void {
    if (!this.map || !this.atlas) return;
    this.clearStops();
    if (!stops.length) return;

    for (const stop of stops) {
      const wrap = document.createElement('div');
      wrap.className = 'lmb-stop-dot';
      wrap.style.cssText =
        'width:10px;height:10px;border-radius:50%;background:var(--signal);' +
        'border:2px solid var(--bg);box-shadow:0 0 0 1px var(--signal);cursor:pointer;';

      const marker = new this.atlas.HtmlMarker({
        htmlContent: wrap,
        position: [stop.position.lng, stop.position.lat],
        anchor: 'center',
      });

      const popup = new this.atlas.Popup({
        content: renderStopPopupHtml(stop),
        position: [stop.position.lng, stop.position.lat],
        pixelOffset: [0, -12],
        closeButton: true,
      });

      // Click toggles a sticky/pinned popup. Re-clicking the same stop
      // closes it. Clicking a different stop swaps the pin. Hover popups
      // can sit alongside a pinned one on a different stop.
      this.map.events.add('click', marker, () => {
        if (this.pinnedPopup === popup) {
          popup.close();
          this.pinnedPopup = null;
          return;
        }
        if (this.pinnedPopup && this.pinnedPopup !== popup) {
          this.pinnedPopup.close();
        }
        // If this stop's popup is currently hover-open, "promote" it.
        if (this.hoverPopup === popup) this.hoverPopup = null;
        else popup.open(this.map!);
        this.pinnedPopup = popup;
      });

      // Hover previews the popup. Coexists with a pinned popup on a
      // different stop. Skip when this same stop is already pinned/hovered.
      this.map.events.add('mouseover', marker, () => {
        if (this.pinnedPopup === popup) return;
        if (this.hoverPopup === popup) return;
        if (this.hoverPopup) this.hoverPopup.close();
        popup.open(this.map!);
        this.hoverPopup = popup;
      });

      this.map.events.add('mouseout', marker, () => {
        if (this.hoverPopup === popup && this.pinnedPopup !== popup) {
          popup.close();
          this.hoverPopup = null;
        }
      });

      // The popup's own X also fires 'close' — reset whichever slot held it.
      this.map.events.add('close', popup, () => {
        if (this.pinnedPopup === popup) this.pinnedPopup = null;
        if (this.hoverPopup === popup) this.hoverPopup = null;
      });

      this.map.markers.add(marker);
      this.stopMarkers.push({ marker, popup });
    }
  }

  clearStops(): void {
    if (this.map) {
      if (this.pinnedPopup) this.pinnedPopup.close();
      if (this.hoverPopup) this.hoverPopup.close();
      for (const { marker, popup } of this.stopMarkers) {
        this.map.markers.remove(marker);
        popup.close();
      }
    }
    this.pinnedPopup = null;
    this.hoverPopup = null;
    this.stopMarkers.length = 0;
  }

  private updateRouteSvg(): void {
    if (!this.map || !this.routeSvg || !this.routeCoords) return;
    // positionsToPixels takes [[lng, lat], ...] and returns [[x, y], ...].
    const pixels = this.map.positionsToPixels(this.routeCoords) as number[][];
    if (!pixels || pixels.length < 2) return;
    const d =
      'M ' +
      pixels
        .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(' L ');
    const base = this.routeSvg.querySelector('.lmb-route-base');
    const dash = this.routeSvg.querySelector('.lmb-route-dash');
    if (base) base.setAttribute('d', d);
    if (dash) dash.setAttribute('d', d);
  }
}

function toAzurePosition(p: LatLng): [number, number] {
  // Azure Maps takes [longitude, latitude], not the usual lat/lng pair.
  return [p.lng, p.lat];
}

// Static popup body for a stop. Kept inside the adapter (rather than
// passed in from the page) because popups are an Azure-SDK construct
// and the page shouldn't have to know about them; the StopPoint shape
// is the contract.
function renderStopPopupHtml(stop: StopPoint): string {
  const lines: string[] = [];
  lines.push(
    `<div style="font-family:var(--font-sans);font-size:13px;font-weight:700;color:var(--text);">${esc(
      stop.name ?? 'Unnamed stop'
    )}</div>`
  );
  const sched = formatArrivalTime(stop.arrivalTime);
  if (sched) {
    lines.push(
      `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-soft);margin-top:4px;">Scheduled: <span style="color:var(--text);font-weight:700;">${esc(sched)}</span></div>`
    );
  }
  if (stop.code) {
    lines.push(
      `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:2px;">Stop code · ${esc(stop.code)}</div>`
    );
  }
  if (stop.accessible) {
    lines.push(
      `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:2px;">♿ Wheelchair accessible</div>`
    );
  }
  // Top + right padding clear room for the SDK's close button (28×28
  // anchored 6px from the top-right corner — see tokens.css).
  return `<div style="padding:38px 40px 12px 14px;min-width:180px;max-width:260px;">${lines.join('')}</div>`;
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatArrivalTime(raw?: string): string {
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length < 2) return raw;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  if (!Number.isFinite(h)) return raw;
  // GTFS uses 24+ to indicate next-day arrivals; wrap.
  let suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  if (h >= 24) {
    h -= 24;
    suffix = 'AM';
  }
  if (h > 12) h -= 12;
  else if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}
