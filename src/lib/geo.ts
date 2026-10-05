import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';

export type GeoFeature = Feature<Geometry, { code: string; name: string }>;
const cache = new Map<string, Promise<GeoFeature[]>>();

/** key: 'uf' (estados), 'br-mun' (Brasil por município) ou a sigla da UF (municípios dela). */
export function loadGeo(key: string): Promise<GeoFeature[]> {
  if (!cache.has(key)) {
    const url = key === 'uf' ? '/geo/uf.json' : key === 'br-mun' ? '/geo/br-mun.json' : `/geo/mun/${key}.json`;
    cache.set(key, fetch(url).then((r) => r.json()).then((topo: Topology) => {
      const obj = Object.values(topo.objects)[0];
      const fc = feature(topo, obj) as unknown as FeatureCollection<Geometry, Record<string, string>>;
      return fc.features.map(rewind).map((f) => ({
        ...f,
        properties: key === 'uf' ? { code: String(f.properties.uf).toLowerCase(), name: String(f.properties.uf) } : { code: String(f.properties.tse), name: String(f.properties.name) },
      }));
    }).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key)!;
}

/** O d3-geo usa geometria esférica: um anel com orientação invertida "cobre o globo" e vira um retângulo. */
function rewind<T extends Feature<Geometry, Record<string, string>>>(f: T): T {
  if (geoArea(f) <= 2 * Math.PI) return f;
  const g = f.geometry;
  if (g.type === 'Polygon') g.coordinates = g.coordinates.map((r) => [...r].reverse());
  if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map((r) => [...r].reverse()));
  return f;
}
