// English base map built on GSI data.
// Shapes (land, water, roads, railways, buildings) come from GSI's optimised vector tiles.
// GSI only has Japanese names, so its labels and symbols are left out. Labels come from
// OpenStreetMap (via OpenFreeMap) and use only the "name:latin" field, which holds a name
// only when one is written in Latin letters. Places with no English name get no label.
// Needs maplibre-gl, pmtiles and @maplibre/maplibre-gl-leaflet loaded first.

const GSI_PMTILES = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles';

// OpenFreeMap / OpenMapTiles / OpenStreetMap credits are added automatically by the label source.
const BASEMAP_ATTRIBUTION =
  '<a href="https://github.com/gsi-cyberjapan/optimal_bvmap" target="_blank">国土地理院最適化ベクトルタイル</a> (GSI Japan)';

// Two colour sets. The map follows the phone's light or dark setting.
const BASEMAP_COLORS = {
  light: {
    land: '#f5f5f2', water: '#c3dbee', waterText: '#4a7fa8',
    bld: '#e3e1dc', bldLine: '#d0cdc6',
    road: '#ffffff', roadCase: '#d5d2cb', major: '#fff4d6', majorCase: '#e3c98c',
    rail: '#8e8e8e', subway: '#b9b9b9',
    text: '#3b3f44', station: '#5a5a5a', city: '#222222', halo: '#ffffff'
  },
  dark: {
    land: '#181b1d', water: '#1c3042', waterText: '#86aed0',
    bld: '#272b2e', bldLine: '#33383c',
    road: '#353a3f', roadCase: '#202326', major: '#4d4535', majorCase: '#2e2a22',
    rail: '#6e7377', subway: '#464b4f',
    text: '#c8ced2', station: '#b4babe', city: '#eceff1', halo: '#131617'
  }
};

// Road width in pixels from GSI's road-width class, scaled by zoom.
const roadWidth = (scale, extra = 0) => ['interpolate', ['exponential', 1.6], ['zoom'],
  13, ['+', extra, ['*', scale * 0.35, ['match', ['get', 'vt_rnkwidth'],
    '19.5m以上', 4, '13m-19.5m未満', 3, '5.5m-13m未満', 2.2, '3m-5.5m未満', 1.4, 1]]],
  19, ['+', extra, ['*', scale * 4, ['match', ['get', 'vt_rnkwidth'],
    '19.5m以上', 6, '13m-19.5m未満', 4.5, '5.5m-13m未満', 3, '3m-5.5m未満', 2, 1.2]]]];
const isMajor = ['in', ['get', 'vt_rdctg'], ['literal', ['国道', '都道府県道', '高速自動車国道等']]];
const latin = ['coalesce', ['get', 'name:latin'], ''];

function basemapStyle(C){ return {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    gsi: { type: 'vector', tiles: ['pmtiles://' + GSI_PMTILES + '/{z}/{x}/{y}'], minzoom: 4, maxzoom: 16 },
    osm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }
  },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': C.land } },
    { id: 'water', type: 'fill', source: 'gsi', 'source-layer': 'WA', paint: { 'fill-color': C.water } },
    { id: 'buildings', type: 'fill', source: 'gsi', 'source-layer': 'BldA', minzoom: 14,
      paint: { 'fill-color': C.bld, 'fill-outline-color': C.bldLine } },
    { id: 'subway', type: 'line', source: 'gsi', 'source-layer': 'RailCL', filter: ['==', ['get', 'vt_railstate'], '地下'],
      paint: { 'line-color': C.subway, 'line-width': 1.2, 'line-dasharray': [3, 3] } },
    { id: 'road-case', type: 'line', source: 'gsi', 'source-layer': 'RdCL', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['case', isMajor, C.majorCase, C.roadCase], 'line-width': roadWidth(1, 1.5) } },
    { id: 'road', type: 'line', source: 'gsi', 'source-layer': 'RdCL', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['case', isMajor, C.major, C.road], 'line-width': roadWidth(1) } },
    { id: 'rail', type: 'line', source: 'gsi', 'source-layer': 'RailCL', filter: ['!=', ['get', 'vt_railstate'], '地下'],
      paint: { 'line-color': C.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 2.5] } },

    { id: 'water-name', type: 'symbol', source: 'osm', 'source-layer': 'water_name',
      layout: { 'text-field': latin, 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'text-max-width': 8 },
      paint: { 'text-color': C.waterText, 'text-halo-color': C.halo, 'text-halo-width': 1.2 } },
    { id: 'road-name', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { 'text-field': latin, 'text-font': ['Noto Sans Regular'], 'text-size': 11,
                'symbol-placement': 'line', 'text-rotation-alignment': 'map' },
      paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
    { id: 'station-name', type: 'symbol', source: 'osm', 'source-layer': 'poi', minzoom: 13,
      filter: ['all', ['==', ['get', 'class'], 'railway'], ['==', ['get', 'subclass'], 'station']],
      layout: { 'text-field': latin, 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-max-width': 8 },
      paint: { 'text-color': C.station, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
    { id: 'place-small', type: 'symbol', source: 'osm', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet']]],
      layout: { 'text-field': latin, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 8 },
      paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
    { id: 'place-big', type: 'symbol', source: 'osm', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: { 'text-field': latin, 'text-font': ['Noto Sans Bold'], 'text-size': 16, 'text-max-width': 8 },
      paint: { 'text-color': C.city, 'text-halo-color': C.halo, 'text-halo-width': 2 } }
  ]
}; }

const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
const basemapTheme = () => (darkQuery && darkQuery.matches) ? 'dark' : 'light';

// Adds the base map to a Leaflet map. Falls back to the GSI pale picture map if the
// vector map cannot start (for example, no WebGL). Returns the layer it added.
function addBasemap(map){
  try {
    if (!window.maplibregl || !window.pmtiles || !L.maplibreGL) throw new Error('vector map code missing');
    if (!window.__pmtilesProtocol) {
      window.__pmtilesProtocol = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', window.__pmtilesProtocol.tile);
    }
    const layer = L.maplibreGL({ style: basemapStyle(BASEMAP_COLORS[basemapTheme()]) }).addTo(map);
    if (map.attributionControl) map.attributionControl.addAttribution(BASEMAP_ATTRIBUTION);
    // Switch colours when the phone changes between light and dark. Only paint changes,
    // so the tiles already loaded are kept.
    if (darkQuery) darkQuery.addEventListener('change', () => {
      const gl = layer.getMaplibreMap && layer.getMaplibreMap();
      if (gl) gl.setStyle(basemapStyle(BASEMAP_COLORS[basemapTheme()]));
    });
    return layer;
  } catch (e) {
    console.warn('Vector base map unavailable, using GSI pale tiles:', e.message);
    return L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxNativeZoom: 18, maxZoom: 20,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
      className: 'pale-tiles'
    }).addTo(map);
  }
}
