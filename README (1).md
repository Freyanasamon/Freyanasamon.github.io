# ABB Signal Tower

Early-warning control tower for AI data-centre electrification demand. Full write-up: [docs/SOLUTION.md](docs/SOLUTION.md).

## Run the prototype (no install)
Open `dashboard/index.html` in a browser. Start at **Summary**, then **▶ Live demo** → *Inject new data*.
After editing `engine.js` or `app.src.html`: `node dashboard/build.js`.

## Backend (FastAPI + LangGraph)
```bash
cd backend
pip install -r requirements.txt
pytest -q                      # parity test vs the JS engine (golden.json)
uvicorn main:app --reload --port 8000
```
Status: the backend was written but **not executed** in the authoring environment (no Python available). The JS engine is the verified reference; `test_golden.py` is the check to run first.

## Use your own data (dashboard)
In the left panel use **Your own data**: **Template** downloads a starter file, **Load data file (JSON)** applies yours, **Reset** restores the built-in demo data.
`dashboard/custom-data.example.json` is a ready-made example. Then open **Live demo** and press *Inject new data*.

The file is a **merge**, not a replacement:
- a signal with an existing `id` is **updated** (send only the fields to change);
- a new `id` is **added** and needs every required field: `id, title, region, layer, horizon, nature, kind, S, C, rel, lead, abb, U, src, load` (optional: `name, pol, corr, challengedBy, new, evidence, products`);
- `raw_feed` (headline `t`, source `src`, optional `maps`) **replaces** the news list in the live demo;
- seed signals cannot be deleted (the narrative and watch-lists refer to them). To neutralise one, lower its `S`/`C`/`rel`, or set `nature` to `false_positive`.

Allowed values: `region` Nordics, USA, Germany, UK, Middle East, APAC, Global; `layer` Core DC, Enabling, Upstream, Downstream; `horizon` leading, coincident, lagging; `nature` structural, cyclical, false_positive; `kind` growth, warning, reversal; `load` G, H, NG, RH, C; scores `S, C, rel, abb, U` 0-100; `lead` months; `pol` 1 (supports growth) or -1 (warns). Invalid files are rejected with a list of what to fix, and nothing is applied. Loaded data is not saved: reloading the page returns to the demo data.
With custom data loaded, the executive briefing is generated from the top signals instead of the built-in Nordic narrative.
The backend still reads `backend/seed.json` (same field names); it has no file-upload endpoint yet.

All seed data is illustrative and anonymised.
