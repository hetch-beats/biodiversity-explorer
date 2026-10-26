import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
// world-atlas ships plain data files with no JS API — Vite's JSON loader
// (resolveJsonModule in tsconfig) parses this straight into a JS object at
// build time. No fetch, no network, works fully offline.
import worldTopology from 'world-atlas/countries-110m.json'

/**
 * A real, industry-standard world country outline — bundled directly in the
 * app via `world-atlas` (maintained by the D3/topojson project, derived
 * from Natural Earth 1:110m data; the same dataset used by countless D3.js
 * maps) plus `topojson-client` to decode it. No runtime fetch, no file to
 * download, works fully offline, and it's actually accurate — replacing an
 * earlier hand-approximated outline that wasn't.
 *
 * Exported as flat [lng, lat] rings (matching GeoJSON's own coordinate
 * order) so Globe.tsx can draw them the same way it draws everything else.
 */
const topology = worldTopology as unknown as Topology<{ countries: GeometryCollection }>
const countries = feature(topology, topology.objects.countries) as unknown as GeoJSON.FeatureCollection

export const WORLD_COUNTRY_RINGS: [number, number][][] = []
for (const f of countries.features) {
  const geom = f.geometry
  if (!geom) continue
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      WORLD_COUNTRY_RINGS.push(ring as [number, number][])
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        WORLD_COUNTRY_RINGS.push(ring as [number, number][])
      }
    }
  }
}
