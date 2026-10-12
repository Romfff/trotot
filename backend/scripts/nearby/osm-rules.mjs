// NEARBY-IMPL-20261010: approved defaults, not a claim of OSM coverage.
import policy from '../../src/nearby/policy.json' with {type:'json'};
export const CONFIG_VERSION = policy.version;
export const GROUPS = Object.freeze(policy.groups);

const allowedTags = ['name', 'name:vi', 'amenity', 'shop', 'brand', 'brand:wikidata', 'wikidata',
  'tourism', 'historic', 'healthcare', 'highway', 'public_transport', 'bus', 'railway', 'station', 'aeroway'];
export function safeTags(input) {
  const output = {};
  for (const key of allowedTags) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() && value.length <= 300
      && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      output[key] = value.trim();
    }
  }
  return output;
}

// A famous place or civilian airport needs separate reviewed evidence; OSM tags alone do not prove it.
export function classifyOsm(tags) {
  if (tags.shop === 'supermarket') return 'MARKETS';
  if (tags.amenity === 'marketplace') return 'MARKETS';
  if (['convenience', 'general'].includes(tags.shop)) return 'GROCERIES';
  if (['university', 'college'].includes(tags.amenity)) return 'UNIVERSITIES';
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'HOSPITALS';
  if (tags.highway === 'bus_stop' || (tags.public_transport === 'platform' && tags.bus === 'yes')) return 'BUS_STOPS';
  if (['attraction', 'museum', 'viewpoint'].includes(tags.tourism)
    || ['monument', 'memorial', 'castle', 'archaeological_site', 'ruins'].includes(tags.historic)) return 'ATTRACTIONS';
  if (['restaurant', 'cafe'].includes(tags.amenity)) return 'DINING';
  if (tags.railway === 'station' && !['subway', 'light_rail'].includes(tags.station)) return 'TRANSPORT';
  return null;
}

// Osmium area IDs encode way*2 and relation*2+1. Use strings/BigInt, not lossy JS numbers.
export function osmIdentity(value) {
  if (typeof value !== 'string' || !/^[nwa][1-9]\d{0,19}$/u.test(value)) throw new Error('Invalid OSM identity');
  const number = BigInt(value.slice(1));
  const type = value[0] === 'n' ? 'node' : value[0] === 'w' ? 'way' : number % 2n === 0n ? 'way' : 'relation';
  const id = value[0] === 'a' ? number / 2n : number;
  if (id < 1n || id > 9223372036854775807n) throw new Error('OSM identity outside int64');
  return { type, id: String(id) };
}

function geometryValid(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  const depth = { Point: 0, LineString: 1, Polygon: 2, MultiPolygon: 3 }[geometry.type];
  if (depth === undefined) return false;
  let points = 0;
  function visit(value, remaining) {
    if (!Array.isArray(value)) return false;
    if (!remaining) {
      points++;
      return value.length === 2 && value.every(Number.isFinite)
        && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
    }
    return value.length > 0 && value.every(child => visit(child, remaining - 1));
  }
  return visit(geometry.coordinates, depth) && points <= 50000;
}

export function normalizeOsmFeature(feature) {
  if (feature?.type !== 'Feature' || !feature.properties || !geometryValid(feature.geometry)) {
    throw new Error('Invalid OSM feature geometry');
  }
  const identity = osmIdentity(feature.id);
  if ((identity.type === 'node') !== (feature.geometry.type === 'Point')) throw new Error('OSM identity/geometry mismatch');
  const version = feature.properties['@version'];
  const rawTimestamp = feature.properties['@timestamp'];
  const timestamp = Number.isSafeInteger(rawTimestamp) && rawTimestamp > 0 && rawTimestamp <= 253402300799
    ? new Date(rawTimestamp * 1000).toISOString().replace('.000Z', 'Z') : rawTimestamp;
  if (!Number.isSafeInteger(version) || version < 1 || typeof timestamp !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp.replace('Z', '.000Z')) {
    throw new Error('Invalid OSM provenance');
  }
  const tags = safeTags(feature.properties);
  const name = tags['name:vi'] || tags.name;
  const category = classifyOsm(tags);
  if (!name || !category) return null;
  return { ...identity, version, timestamp, name, category, tags, geometry: feature.geometry,
    representativeMethod: feature.geometry.type === 'Point' ? 'OSM_POINT' : 'POINT_ON_SURFACE' };
}
