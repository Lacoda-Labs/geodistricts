/**
 * Project geographic coordinates to SVG and build path d from GeoJSON.
 */

import { GeoJsonFeatureCollection, GeoJsonGeometry } from '../services/congressional-boundaries.service';

export interface SvgBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function project(lng: number, lat: number, b: SvgBounds): [number, number] {
  const x = b.x1 + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (b.x2 - b.x1);
  const y = b.y2 - ((lat - b.minLat) / (b.maxLat - b.minLat)) * (b.y2 - b.y1);
  return [x, y];
}

function ringToPathD(ring: number[][], b: SvgBounds): string {
  if (ring.length < 2) return '';
  const [x0, y0] = project(ring[0][0], ring[0][1], b);
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1], b);
    d += ` L ${x} ${y}`;
  }
  return d + ' Z';
}

function geometryToPathDs(geom: GeoJsonGeometry, b: SvgBounds): string[] {
  const out: string[] = [];
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const rings = geom.coordinates as number[][][];
    rings.forEach(ring => {
      const d = ringToPathD(ring, b);
      if (d) out.push(d);
    });
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const polys = geom.coordinates as number[][][][];
    polys.forEach(poly => {
      poly.forEach(ring => {
        const d = ringToPathD(ring, b);
        if (d) out.push(d);
      });
    });
  }
  return out;
}

export function featureCollectionToPathDs(
  collection: GeoJsonFeatureCollection,
  bounds: SvgBounds
): string[] {
  const paths: string[] = [];
  collection.features.forEach(f => {
    paths.push(...geometryToPathDs(f.geometry, bounds));
  });
  return paths;
}

/** CONUS: continental US in main map area */
export const CONUS_BOUNDS: SvgBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66,
  maxLat: 50,
  x1: 40,
  y1: 40,
  x2: 760,
  y2: 460
};

/** Alaska inset (transformed coords space) */
export const ALASKA_INSET_BOUNDS: SvgBounds = {
  minLng: -132,
  minLat: 20,
  maxLng: -128,
  maxLat: 24,
  x1: 40,
  y1: 380,
  x2: 200,
  y2: 500
};

/** Hawaii inset (transformed coords space) */
export const HAWAII_INSET_BOUNDS: SvgBounds = {
  minLng: -161,
  minLat: 18,
  maxLng: -155,
  maxLat: 23,
  x1: 220,
  y1: 380,
  x2: 360,
  y2: 500
};

export const SVG_VIEWBOX = '0 0 800 500';
