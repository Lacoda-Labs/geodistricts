# Census API Key Setup

To use the direct Census API functions in the geodistrict algorithm, you need to:

1. Get a free Census API key from: https://api.census.gov/data/key_signup.html

2. Set up your API key configuration:
   - Copy `frontend/src/config/api-keys.template.ts` to `frontend/src/config/api-keys.ts`
   - Replace `'YOUR_CENSUS_API_KEY_HERE'` with your actual API key
   - The `api-keys.ts` file is in `.gitignore` to keep your key secure

3. The geodistrict algorithm will use the direct Census API by default, but you can also use the backend proxy by unchecking "Use Direct Census API" in the interface.

## Alternative: Use Backend Proxy

If you prefer to use the existing backend proxy (which handles the API key), you can:
- Leave the Census API key as is
- Uncheck "Use Direct Census API" in the geodistrict viewer interface
- The algorithm will use the backend proxy service instead

## Testing

The geodistrict algorithm is set to use California (52 districts) as the default state for testing. You can change the state in the dropdown to test with other states.