/**
 * Transform GeoJSON coordinates for inset maps (e.g. Alaska, Hawaii).
 * Scale and translate so the geometry fits in a small box (e.g. lower-left of US map).
 */

import { GeoJsonFeatureCollection, GeoJsonFeature, GeoJsonGeometry } from '../services/congressional-boundaries.service';

export interface TransformOptions {
  /** Scale factor (e.g. 0.3) */
  scale: number;
  /** Center of source geometry [lng, lat] used as origin for scaling */
  centerLng: number;
  centerLat: number;
  /** Inset center [lng, lat] where the scaled geometry will be placed */
  insetLng: number;
  insetLat: number;
}

/**
 * Transform a single coordinate: scale around center then translate to inset center.
 */
function transformCoord(
  lng: number,
  lat: number,
  opts: TransformOptions
): [number, number] {
  const newLng = (lng - opts.centerLng) * opts.scale + opts.insetLng;
  const newLat = (lat - opts.centerLat) * opts.scale + opts.insetLat;
  return [newLng, newLat];
}

function transformRing(ring: number[][], opts: TransformOptions): number[][] {
  return ring.map(([lng, lat]) => transformCoord(lng, lat, opts));
}

function transformGeometry(geom: GeoJsonGeometry, opts: TransformOptions): GeoJsonGeometry {
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    return {
      type: 'Polygon',
      coordinates: (geom.coordinates as number[][][]).map(ring => transformRing(ring, opts))
    };
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const coords = geom.coordinates as number[][][][];
    return {
      type: 'MultiPolygon',
      coordinates: coords.map(poly =>
        poly.map(ring => transformRing(ring, opts))
      )
    };
  }
  return geom;
}

/**
 * Transform all coordinates in a FeatureCollection (e.g. for Alaska or Hawaii inset).
 */
export function transformGeoJson(
  collection: GeoJsonFeatureCollection,
  opts: TransformOptions
): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((f: GeoJsonFeature) => ({
      ...f,
      geometry: transformGeometry(f.geometry, opts)
    }))
  };
}

/** Approximate centers and default inset positions for Alaska and Hawaii */
export const ALASKA_TRANSFORM: TransformOptions = {
  scale: 0.28,
  centerLng: -153.5,
  centerLat: 64,
  insetLng: -130,
  insetLat: 22
};

export const HAWAII_TRANSFORM: TransformOptions = {
  scale: 0.35,
  centerLng: -155.5,
  centerLat: 20.5,
  insetLng: -160,
  insetLat: 22
};
