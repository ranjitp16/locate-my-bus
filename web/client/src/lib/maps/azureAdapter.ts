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
} from './adapter';

type AtlasNs = typeof atlasType;
type AtlasMap = InstanceType<AtlasNs['Map']>;
type AtlasMarker = InstanceType<AtlasNs['HtmlMarker']>;

export class AzureMapAdapter implements MapAdapter {
  private atlas: AtlasNs | null = null;
  private map: AtlasMap | null = null;
  private readonly markers = new Map<string, AtlasMarker>();
  private readonly elements = new Map<string, HTMLDivElement>();

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
}

function toAzurePosition(p: LatLng): [number, number] {
  // Azure Maps takes [longitude, latitude], not the usual lat/lng pair.
  return [p.lng, p.lat];
}
