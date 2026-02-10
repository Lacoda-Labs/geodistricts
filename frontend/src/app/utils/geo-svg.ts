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

export interface GeoBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function project(lng: number, lat: number, b: SvgBounds): [number, number] {
  const x = b.x1 + ((lng - b.minLng) / (b.maxLng - b.minLng)) * (b.x2 - b.x1);
  const y = b.y2 - ((lat - b.minLat) / (b.maxLat - b.minLat)) * (b.y2 - b.y1);
  return [x, y];
}

/** Project with uniform scale so aspect ratio is preserved; geometry is centered in the SVG box. */
export function projectUniform(
  lng: number,
  lat: number,
  geo: GeoBbox,
  svgX1: number,
  svgY1: number,
  svgX2: number,
  svgY2: number
): [number, number] {
  const geoW = geo.maxLng - geo.minLng || 1;
  const geoH = geo.maxLat - geo.minLat || 1;
  const svgW = svgX2 - svgX1;
  const svgH = svgY2 - svgY1;
  const scale = Math.min(svgW / geoW, svgH / geoH);
  const scaledW = geoW * scale;
  const scaledH = geoH * scale;
  const offsetX = svgX1 + (svgW - scaledW) / 2;
  const offsetY = svgY2 - (svgH - scaledH) / 2;
  const x = offsetX + ((lng - geo.minLng) / geoW) * scaledW;
  const y = offsetY - ((lat - geo.minLat) / geoH) * scaledH;
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

function ringToPathDUniform(
  ring: number[][],
  geo: GeoBbox,
  svgX1: number,
  svgY1: number,
  svgX2: number,
  svgY2: number
): string {
  if (ring.length < 2) return '';
  const [x0, y0] = projectUniform(ring[0][0], ring[0][1], geo, svgX1, svgY1, svgX2, svgY2);
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = projectUniform(ring[i][0], ring[i][1], geo, svgX1, svgY1, svgX2, svgY2);
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

/** One array of path d strings per feature (district). */
export function featureCollectionToPathDsByFeature(
  collection: GeoJsonFeatureCollection,
  bounds: SvgBounds
): string[][] {
  return collection.features.map(f => geometryToPathDs(f.geometry, bounds)).filter(p => p.length > 0);
}

/** Get bounding box of a feature collection (all coordinates). */
export function getCollectionBbox(collection: GeoJsonFeatureCollection): GeoBbox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let hasAny = false;

  function addCoord(lng: number, lat: number): void {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
    hasAny = true;
  }

  collection.features.forEach(f => {
    const g = f.geometry;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      (g.coordinates as number[][][]).forEach(ring => ring.forEach(([lng, lat]) => addCoord(lng, lat)));
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      (g.coordinates as number[][][][]).forEach(poly =>
        poly.forEach(ring => ring.forEach(([lng, lat]) => addCoord(lng, lat)))
      );
    }
  });

  if (!hasAny) return null;
  return { minLng, minLat, maxLng, maxLat };
}

function geometryToPathDsUniform(
  geom: GeoJsonGeometry,
  geo: GeoBbox,
  svgX1: number,
  svgY1: number,
  svgX2: number,
  svgY2: number
): string[] {
  const out: string[] = [];
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const rings = geom.coordinates as number[][][];
    rings.forEach(ring => {
      const d = ringToPathDUniform(ring, geo, svgX1, svgY1, svgX2, svgY2);
      if (d) out.push(d);
    });
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const polys = geom.coordinates as number[][][][];
    polys.forEach(poly => {
      poly.forEach(ring => {
        const d = ringToPathDUniform(ring, geo, svgX1, svgY1, svgX2, svgY2);
        if (d) out.push(d);
      });
    });
  }
  return out;
}

/** Build path d strings with uniform scale so aspect ratio is preserved; geometry is centered in the SVG box. */
export function featureCollectionToPathDsWithUniformScale(
  collection: GeoJsonFeatureCollection,
  svgX1: number,
  svgY1: number,
  svgX2: number,
  svgY2: number
): string[] {
  const geo = getCollectionBbox(collection);
  if (!geo) return [];
  const paths: string[] = [];
  collection.features.forEach(f => {
    paths.push(...geometryToPathDsUniform(f.geometry, geo, svgX1, svgY1, svgX2, svgY2));
  });
  return paths;
}

/** One array of path d strings per feature (district), uniform scale. */
export function featureCollectionToPathDsByFeatureWithUniformScale(
  collection: GeoJsonFeatureCollection,
  svgX1: number,
  svgY1: number,
  svgX2: number,
  svgY2: number
): string[][] {
  const geo = getCollectionBbox(collection);
  if (!geo) return [];
  return collection.features
    .map(f => geometryToPathDsUniform(f.geometry, geo, svgX1, svgY1, svgX2, svgY2))
    .filter(p => p.length > 0);
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
