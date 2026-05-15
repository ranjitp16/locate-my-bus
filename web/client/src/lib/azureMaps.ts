import type * as atlasType from 'azure-maps-control';

// Rewrites every atlas.microsoft.com call through our server proxy so the real
// subscription key stays on the backend. The X-Azure-Maps-Proxy header is the
// anti-forgery signal the server checks for.
export const proxyAuthOptions: atlasType.AuthenticationOptions = {
  authType: 'subscriptionKey' as atlasType.AuthenticationType,
  subscriptionKey: '__proxied__',
};

export function proxyTransformRequest(url: string): atlasType.RequestParameters {
  if (typeof url === 'string' && url.indexOf('atlas.microsoft.com') !== -1) {
    const u = new URL(url);
    u.searchParams.delete('subscription-key');
    return {
      url: window.location.origin + '/api/azure-maps' + u.pathname + u.search,
      headers: { 'X-Azure-Maps-Proxy': '1' },
    };
  }
  return { url };
}

export type Vehicle = {
  vehicle_id: string;
  route_id: string;
  trip_id: string;
  lat: number;
  lon: number;
  bearing?: number;
  speed?: number;
  timestamp?: string | number;
  stop_id?: string;
};

export type Agency = {
  id: string;
  name: string;
  url?: string;
  timezone?: string;
  language?: string;
  phone?: string;
  fare_url?: string;
};

export type Route = {
  id: string;
  long_name: string;
};
