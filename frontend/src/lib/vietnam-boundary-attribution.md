# Attribution: offline coordinate input guard

This file documents the geographic data in `vietnam-boundary.json`. It is not a geocoding service and does not introduce a new runtime provider.

- Main geometry: [geoBoundaries gbOpen Vietnam ADM0](https://www.geoboundaries.org/api/current/gbOpen/VNM/ADM0/), boundary ID `VNM-ADM0-46766057`, source revision `9469f09`, representing 2016. Attribution: geoBoundaries / William & Mary geoLab. License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Additional Con Son island geometry: [Natural Earth 1:10m Admin 0 countries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_countries.geojson), VNM feature, fetched 2026-10-05. Natural Earth data are [public domain](https://www.naturalearthdata.com/about/terms-of-use/). Only the island polygon was added; other country polygons were not replaced.
- Transformations: retain longitude/latitude only, round vertices to six decimals, combine the supplemental island polygon into a MultiPolygon. No fabricated island, ward centroid, buffering or provider calls.

This is a coarse geographic **input guard**, not cadastral data or an authoritative boundary/sovereignty determination. Simplified coastlines can reject points close to shore; small islands may be missing. A real production provider/authoritative geometry must be selected and verified before claiming complete Vietnam coverage. The UI does not assert that coordinates belong to the selected ward; it only preserves the existing province/ward DTO and checks this offline geometry.

The live map continues to use the project's existing OpenStreetMap basemap with visible attribution. Basemap tiles are separate from address lookup. Address lookup is blocked until the project owner chooses a provider; no address is sent to an invented external geocoder.
