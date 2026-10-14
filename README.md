# upcrouter

BernCo Property Route Planner: a single-file web app (`index.html`) that turns parcel UPCs into a field route, using Bernalillo County's public parcel GIS, OSRM routing, OpenStreetMap tiles, and Google Maps for navigation.

`index.html` is a compiled Vite/React build that has been edited directly. There is no separate source project in this repository.

## Tests

Browser tests live in `tests/` and run on every pull request (`.github/workflows/tests.yml`). County GIS, OSRM, map tiles, and the Assessor web map are mocked, so the tests never contact those services.

```sh
cd tests
npm ci
npx playwright install chromium
npx playwright test
```

## Assessor Map links

"Open parcel in Assessor Map" links select the parcel by UPC on the county's Assessor Map. The link needs the Assessor Map's parcel layer ID (`yh` in `index.html`), which changes when the county re-adds that layer. On load the planner reads the county web map and follows a re-added layer automatically.

If links ever open at the countywide view again, select any parcel on the Assessor Map and copy the ID from its address bar, which looks like `data_s=id%3A<layer-id>%3A<object-id>`. Then set `yh` to that `<layer-id>`.

## Opening the planner from a link

A link like `https://thecraftyslayer.github.io/upcrouter/#upcs=<UPC>,<UPC>` opens the planner and builds the route for those UPCs. The A.C.E.S. `UPC_Router_Link` tool builds these links.

- If public map and routing services are already allowed in this browser session, the route builds right away, ordered by drive time, with the map showing.
- If they aren't, one dialog explains what OpenStreetMap and OSRM receive and offers **Allow and build route**. Cancel leaves the UPCs in the box without looking anything up. A link never grants that consent by itself.
- If a saved route is open, the link only fills the UPC box. Build route then asks before replacing the active route.

The list is read once after any saved route has loaded, then removed from the address bar so a refresh doesn't re-import it. It rides in the `#` part of the address, which browsers never send to the web server. Links carry at most 150 UPCs.
