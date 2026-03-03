# 250223

## 1430 default year 2024

### Prompt

make default year 2024 (not 2020)

### Response / actions

✅ **IMPLEMENTED**: Default VEST/tract-party year is now 2024 everywhere.

- **Backend** ([backend/index.js](backend/index.js)): `DEFAULT_VEST_YEAR = 2024`; algorithm run year, maps-comparison `vestYear`, GET `/api/poligeo/state-summary`, and POST `/api/vest/bulk-download-persist` defaults set to 2024; JSDoc updated.
- **Backend** ([backend/services/vest-data-loader.js](backend/services/vest-data-loader.js)): `getTractData(geoids, year = 2024, ...)`.
- **Backend** ([backend/services/maps-comparison.js](backend/services/maps-comparison.js)): `VEST_YEAR_DEFAULT = 2024` and JSDoc.
- **Frontend** ([frontend/src/app/pages/maps-page.component.ts](frontend/src/app/pages/maps-page.component.ts)): Both `getTractParty(..., 2024)` call sites.
- **Script** ([backend/scripts/run-tract-party-persistence.js](backend/scripts/run-tract-party-persistence.js)): Example and error message updated to say default 2024 (script already used `VEST_YEAR || '2024'`).

Supported years (2016, 2020, 2024) and VEST dataset configs unchanged.
