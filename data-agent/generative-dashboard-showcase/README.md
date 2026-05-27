# Generative Dashboard Showcase (React + WrenAI API)

This app demonstrates runtime dashboard generation where:
- React owns layout, widget rendering, and interactions.
- WrenAI provides schema-aware reasoning, SQL candidates, and chart specs via API.

## Structure

- `server/`: Express BFF that proxies/orchestrates WrenAI async endpoints.
- `web/`: React + Vite frontend that renders generated widgets (Vega-Lite specs).

## Implemented WrenAI Flows

- `POST /v1/semantics-preparations` + polling status
- `POST /v1/asks` + polling result
- `POST /v1/question-recommendations` + polling result
- `POST /v1/charts` + polling result

The BFF exposes these under:
- `GET /api/config`
- `GET /api/wren/mdl` (pull deployed MDL from Wren UI GraphQL by hash)
- `POST /api/wren/prepare-semantics`
- `POST /api/wren/ask`
- `POST /api/wren/recommend`
- `POST /api/wren/chart`
- `POST /api/wren/generate-dashboard` (orchestrated intent -> widgets)

## Run

From this folder:

```bash
cd /home/viktor/repos/ruikangResearch/Research/data-agent/generative-dashboard-showcase
npm install
npm run dev
```

Default ports:
- BFF: `http://localhost:4100`
- Web: `http://localhost:4173`

## Configure

1. Copy env templates if needed:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env
cp server/config.json.example server/config.json
```

2. Configure Wren API in `server/config.json`:
- `wren.baseUrl` (example: `http://localhost:5555`)
- `wren.uiGraphqlUrl` (example: `http://localhost:3000/api/graphql`)
- `wren.projectId` (optional depending on your deployment)
- `wren.deployId` (semantic hash/id used by `/v1/asks`)
- `wren.language`, `wren.timezoneName`

3. Optional: override config values via `server/.env` (env wins over `config.json`):
- `WREN_BASE_URL`, `WREN_UI_GRAPHQL_URL`, `WREN_PROJECT_ID`, `WREN_DEPLOY_ID`, `WREN_LANGUAGE`, `WREN_TIMEZONE_NAME`

4. MDL handling:
- The app can pull MDL automatically from Wren API (`getMDL`) using configured deploy hash.
- In UI, use **Pull MDL** to inspect/edit MDL, then **Prepare Semantics**.
- Even without manual paste, backend auto-fetches MDL for `prepare-semantics` and `generate-dashboard`.

## Usage

1. Enter user intent.
2. Click **Generate Dashboard**.
3. The app will:
- call `ask` to get SQL candidates,
- generate chart for primary SQL,
- auto-resolve MDL (from request or Wren API),
- optionally call `question-recommendations` and generate more widgets.

## Notes

- The chart request sets `remove_data_from_chart_schema=false` so specs include data and can be rendered directly in React.
- If some recommendations fail chart generation, SQL widgets are still returned (without chart schema).

## Live Test

Run a live integration check for dashboard generation (uses your real Wren setup from `server/config.json` or env):

```bash
cd /home/viktor/repos/ruikangResearch/Research/data-agent/generative-dashboard-showcase/server
npm run test
```

Optional env vars:
- `GD_TEST_INTENT` (forces a specific intent instead of auto-recommend)
- `GD_TEST_MDL` (skip MDL GraphQL fetch and use this MDL string)
- `GD_TEST_MAX_WIDGETS` (default: `1`)
