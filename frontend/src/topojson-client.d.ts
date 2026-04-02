declare module 'topojson-client' {
  export function feature(topology: unknown, object: unknown): GeoJSON.Feature | GeoJSON.FeatureCollection;
}
