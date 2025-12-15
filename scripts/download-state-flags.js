const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// All 50 US states with their 2-letter abbreviations
const states = [
  { name: 'Alabama', abbrev: 'AL' },
  { name: 'Alaska', abbrev: 'AK' },
  { name: 'Arizona', abbrev: 'AZ' },
  { name: 'Arkansas', abbrev: 'AR' },
  { name: 'California', abbrev: 'CA' },
  { name: 'Colorado', abbrev: 'CO' },
  { name: 'Connecticut', abbrev: 'CT' },
  { name: 'Delaware', abbrev: 'DE' },
  { name: 'Florida', abbrev: 'FL' },
  { name: 'Georgia', abbrev: 'GA' },
  { name: 'Hawaii', abbrev: 'HI' },
  { name: 'Idaho', abbrev: 'ID' },
  { name: 'Illinois', abbrev: 'IL' },
  { name: 'Indiana', abbrev: 'IN' },
  { name: 'Iowa', abbrev: 'IA' },
  { name: 'Kansas', abbrev: 'KS' },
  { name: 'Kentucky', abbrev: 'KY' },
  { name: 'Louisiana', abbrev: 'LA' },
  { name: 'Maine', abbrev: 'ME' },
  { name: 'Maryland', abbrev: 'MD' },
  { name: 'Massachusetts', abbrev: 'MA' },
  { name: 'Michigan', abbrev: 'MI' },
  { name: 'Minnesota', abbrev: 'MN' },
  { name: 'Mississippi', abbrev: 'MS' },
  { name: 'Missouri', abbrev: 'MO' },
  { name: 'Montana', abbrev: 'MT' },
  { name: 'Nebraska', abbrev: 'NE' },
  { name: 'Nevada', abbrev: 'NV' },
  { name: 'New Hampshire', abbrev: 'NH' },
  { name: 'New Jersey', abbrev: 'NJ' },
  { name: 'New Mexico', abbrev: 'NM' },
  { name: 'New York', abbrev: 'NY' },
  { name: 'North Carolina', abbrev: 'NC' },
  { name: 'North Dakota', abbrev: 'ND' },
  { name: 'Ohio', abbrev: 'OH' },
  { name: 'Oklahoma', abbrev: 'OK' },
  { name: 'Oregon', abbrev: 'OR' },
  { name: 'Pennsylvania', abbrev: 'PA' },
  { name: 'Rhode Island', abbrev: 'RI' },
  { name: 'South Carolina', abbrev: 'SC' },
  { name: 'South Dakota', abbrev: 'SD' },
  { name: 'Tennessee', abbrev: 'TN' },
  { name: 'Texas', abbrev: 'TX' },
  { name: 'Utah', abbrev: 'UT' },
  { name: 'Vermont', abbrev: 'VT' },
  { name: 'Virginia', abbrev: 'VA' },
  { name: 'Washington', abbrev: 'WA' },
  { name: 'West Virginia', abbrev: 'WV' },
  { name: 'Wisconsin', abbrev: 'WI' },
  { name: 'Wyoming', abbrev: 'WY' }
];

const outputDir = path.join(__dirname, '../frontend/public/images/state-flags/23x15');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Wikimedia Commons file paths for state flags (known working patterns)
const wikiCommonsPaths = {
  'AK': 'a/a5/Flag_of_Alaska.svg',
  'AL': '5/5c/Flag_of_Alabama.svg',
  'AR': '9/9d/Flag_of_Arkansas.svg',
  'AZ': '9/9d/Flag_of_Arizona.svg',
  'CA': '0/01/Flag_of_California.svg',
  'CO': '4/46/Flag_of_Colorado.svg',
  'CT': '9/96/Flag_of_Connecticut.svg',
  'DE': 'c/c6/Flag_of_Delaware.svg',
  'FL': 'f/f7/Flag_of_Florida.svg',
  'GA': '5/54/Flag_of_Georgia_%28U.S._state%29.svg',
  'HI': 'e/ef/Flag_of_Hawaii.svg',
  'IA': 'a/aa/Flag_of_Iowa.svg',
  'ID': 'a/a4/Flag_of_Idaho.svg',
  'IL': '0/01/Flag_of_Illinois.svg',
  'IN': 'a/ac/Flag_of_Indiana.svg',
  'KS': 'd/da/Flag_of_Kansas.svg',
  'KY': '8/8d/Flag_of_Kentucky.svg',
  'LA': 'e/e0/Flag_of_Louisiana.svg',
  'MA': 'f/f2/Flag_of_Massachusetts.svg',
  'MD': 'a/a0/Flag_of_Maryland.svg',
  'ME': '3/35/Flag_of_Maine.svg',
  'MI': 'b/b5/Flag_of_Michigan.svg',
  'MN': 'b/b9/Flag_of_Minnesota.svg',
  'MO': '5/5a/Flag_of_Missouri.svg',
  'MS': '4/42/Flag_of_Mississippi.svg',
  'MT': 'c/cb/Flag_of_Montana.svg',
  'NC': 'b/bb/Flag_of_North_Carolina.svg',
  'ND': 'e/ee/Flag_of_North_Dakota.svg',
  'NE': '4/4d/Flag_of_Nebraska.svg',
  'NH': '2/28/Flag_of_New_Hampshire.svg',
  'NJ': '9/92/Flag_of_New_Jersey.svg',
  'NM': 'c/c3/Flag_of_New_Mexico.svg',
  'NV': 'f/f1/Flag_of_Nevada.svg',
  'NY': '1/1a/Flag_of_New_York.svg',
  'OH': '4/4c/Flag_of_Ohio.svg',
  'OK': '6/6e/Flag_of_Oklahoma.svg',
  'OR': 'b/b9/Flag_of_Oregon.svg',
  'PA': 'f/f7/Flag_of_Pennsylvania.svg',
  'RI': 'f/f4/Flag_of_Rhode_Island.svg',
  'SC': '6/69/Flag_of_South_Carolina.svg',
  'SD': '1/1a/Flag_of_South_Dakota.svg',
  'TN': '9/9e/Flag_of_Tennessee.svg',
  'TX': 'f/f7/Flag_of_Texas.svg',
  'UT': 'f/f6/Flag_of_Utah.svg',
  'VA': '4/47/Flag_of_Virginia.svg',
  'VT': '4/49/Flag_of_Vermont.svg',
  'WA': '5/54/Flag_of_Washington.svg',
  'WI': '2/22/Flag_of_Wisconsin.svg',
  'WV': '2/22/Flag_of_West_Virginia.svg',
  'WY': 'b/bc/Flag_of_Wyoming.svg'
};

// States that conflict with ISO country codes (flagcdn.com would return wrong flags)
// CA=Canada, CO=Colombia, GA=Georgia(country), IN=India, LA=Laos, MA=Morocco, MD=Moldova, 
// MS=Montserrat, MT=Malta, NE=Niger, NV=Not a country but might conflict, NY=Not a country,
// OR=Not a country, PA=Panama, SC=Seychelles, SD=Sudan, TN=Tunisia, TX=Not a country,
// UT=Not a country, VA=Vatican, WA=Not a country, WI=Not a country, AZ=Azerbaijan
const countryCodeConflicts = new Set(['AZ', 'CA', 'CO', 'GA', 'IN', 'LA', 'MA', 'MD', 'MS', 'MT', 'NE', 'NV', 'NY', 'OR', 'PA', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'WA', 'WI']);

// Function to get flag image URLs (multiple sources to try)
function getFlagUrls(abbrev) {
  const lowerAbbrev = abbrev.toLowerCase();
  const wikiPath = wikiCommonsPaths[abbrev];
  const urls = [];
  
  // Prioritize Wikimedia Commons (correct state flags)
  // Wikimedia Commons thumbnail format: /thumb/{path}/{width}px-{filename}.png
  if (wikiPath) {
    const filename = wikiPath.split('/').pop();
    urls.push(`https://upload.wikimedia.org/wikipedia/commons/thumb/${wikiPath}/320px-${filename}.png`);
  }
  
  // Only use flagcdn.com for states that don't conflict with country codes
  // (flagcdn.com uses ISO country codes, so CA=Canada, not California!)
  if (!countryCodeConflicts.has(abbrev)) {
    urls.push(`https://flagcdn.com/w320/${lowerAbbrev}.png`);
    urls.push(`https://flagcdn.com/256x192/${lowerAbbrev}.png`);
  }
  
  // Add alternative sources for specific states that might need them
  if (abbrev === 'RI') {
    urls.push('https://cdn.countryflags.com/thumbs/rhode-island/flag-400.png');
  }
  if (abbrev === 'AK') {
    urls.push('https://cdn.countryflags.com/thumbs/alaska/flag-400.png');
  }
  if (abbrev === 'GA') {
    // Georgia (US state) - try alternative Wikimedia paths
    urls.push('https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Flag_of_Georgia_%28U.S._state%29.svg/256px-Flag_of_Georgia_%28U.S._state%29.svg.png');
    urls.push('https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Flag_of_Georgia_%28U.S._state%29.svg/512px-Flag_of_Georgia_%28U.S._state%29.svg.png');
    // Use a state-specific service
    urls.push('https://www.50states.com/flag/image/nunst007.gif'); // This might be a GIF, but we can try
  }
  
  return urls;
}


// Function to download and process a single flag
async function downloadAndProcessFlag(state) {
  const { name, abbrev } = state;
  const outputPath = path.join(outputDir, `${abbrev}.png`);
  
  // Skip if file already exists
  if (fs.existsSync(outputPath)) {
    console.log(`✓ ${abbrev}.png already exists, skipping ${name}`);
    return;
  }

  const urls = getFlagUrls(abbrev);
  let lastError = null;

  for (let i = 0; i < urls.length; i++) {
    try {
      if (i === 0) {
        console.log(`Downloading ${name} (${abbrev})...`);
      } else {
        console.log(`  Trying alternative source ${i + 1}/${urls.length} for ${abbrev}...`);
      }

      const response = await axios.get(urls[i], {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GeoDistricts/1.0)'
        },
        validateStatus: (status) => status === 200 // Only accept 200 OK
      });

      // Process the image: convert to PNG and resize to 23x15
      await sharp(response.data)
        .resize(23, 15, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ Successfully processed ${abbrev}.png${i > 0 ? ` (source ${i + 1})` : ''}`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
      return; // Success, exit the function
    } catch (error) {
      lastError = error;
      // Continue to next URL
    }
  }

  // All URLs failed
  console.error(`✗ Error processing ${name} (${abbrev}): All sources failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

// Main function to process all flags
async function main() {
  console.log(`Starting download and processing of ${states.length} state flags...`);
  console.log(`Output directory: ${outputDir}\n`);

  for (const state of states) {
    await downloadAndProcessFlag(state);
  }

  console.log('\n✓ All flags processed!');
  
  // List all files in output directory
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
  console.log(`\nTotal files created: ${files.length}`);
  console.log('Files:', files.sort().join(', '));
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

