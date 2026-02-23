/**
 * VEST Data Downloader Service
 * Downloads all available tract-level VEST data files for a given year
 */

const vestDataLoader = require('./vest-data-loader');

// VEST Dataset Configuration (duplicated from vest-data-loader.js)
const VEST_DATASETS = {
  2016: {
    persistentId: 'doi:10.7910/DVN/NH5S2I',
    datasetUrl: 'https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/NH5S2I',
    tractFilePatterns: ['tract_2016', '*tract*2016*', 'vest_2016_tract', 'tract16', 'tract_16']
  },
  2020: {
    persistentId: 'doi:10.7910/DVN/VOQCHQ',
    datasetUrl: 'https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ',
    tractFilePatterns: ['tract_2020', '*tract*2020*', 'vest_2020_tract', 'tract20', 'tract_20']
  },
  2024: {
    persistentId: null, // To be determined when available
    datasetUrl: null,
    tractFilePatterns: ['tract_2024.csv', '*tract*2024*.csv', 'vest_2024_tract.csv']
  }
};

class VESTDataDownloader {
  constructor() {
    this.vestLoader = vestDataLoader;
  }

  /**
   * Download all available tract-level VEST data files for a year
   * @param {number} year - Election year (e.g., 2020)
   * @returns {Promise<{downloaded: Array, failed: Array, skipped: Array}>}
   */
  async downloadAllTractFilesForYear(year = 2020) {
    const results = {
      downloaded: [],
      failed: [],
      skipped: []
    };

    try {
      console.log(`🔍 Discovering all tract-level files for VEST ${year}...`);

      // Get list of all files from Dataverse
      const persistentId = VEST_DATASETS[year]?.persistentId;
      if (!persistentId) {
        throw new Error(`No dataset configuration found for year ${year}`);
      }

      const files = await this.vestLoader.listDatasetFiles(persistentId);
      console.log(`📋 Found ${files.length} total files in dataset`);

      // Filter for tract-level files
      const tractFiles = files.filter(file => {
        const filename = file.dataFile?.filename || file.label || '';
        return this.isTractFile(filename, year);
      });

      console.log(`🎯 Found ${tractFiles.length} tract-level files for ${year}`);

      // Download each tract file
      for (const file of tractFiles) {
        try {
          const filename = file.dataFile?.filename || file.label;
          const stateCode = this.extractStateFromFilename(filename);

          console.log(`📥 Downloading ${filename}...`);

          // Download the file
          const downloadResult = await this.vestLoader.downloadFileById(file.dataFile.id);

          results.downloaded.push({
            state: stateCode,
            filename,
            fileId: file.dataFile.id,
            size: downloadResult?.size || 0
          });

          console.log(`✅ Downloaded ${filename} (${this.formatBytes(downloadResult?.size || 0)})`);

        } catch (error) {
          console.error(`❌ Failed to download ${file.dataFile?.filename || file.label}:`, error.message);
          results.failed.push({
            filename: file.dataFile?.filename || file.label,
            fileId: file.dataFile?.id,
            error: error.message
          });
        }
      }

      console.log(`\n📊 Download Summary:`);
      console.log(`   ✅ Downloaded: ${results.downloaded.length} files`);
      console.log(`   ❌ Failed: ${results.failed.length} files`);
      console.log(`   ⏭️ Skipped: ${results.skipped.length} files`);

      return results;

    } catch (error) {
      console.error('❌ VEST data download failed:', error.message);
      throw error;
    }
  }

  /**
   * Check if a filename represents a tract-level data file
   * @param {string} filename - File name to check
   * @param {number} year - Election year
   * @returns {boolean}
   */
  isTractFile(filename, year) {
    if (!filename) return false;

    const lowerName = filename.toLowerCase();

    // Must be CSV, TAB, or TSV
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.tab') && !lowerName.endsWith('.tsv')) {
      return false;
    }

    // Must contain "tract" and the year
    if (!lowerName.includes('tract') || !lowerName.includes(year.toString())) {
      return false;
    }

    // Exclude non-data files
    if (lowerName.includes('readme') || lowerName.includes('codebook') || lowerName.includes('metadata')) {
      return false;
    }

    return true;
  }

  /**
   * Extract state code from filename
   * @param {string} filename - File name
   * @returns {string|null} - State code or null if not found
   */
  extractStateFromFilename(filename) {
    if (!filename) return null;

    // Common patterns in VEST filenames:
    // - STATE_tract_YEAR.csv (e.g., AZ_tract_2020.csv)
    // - state_tract_YEAR.csv (e.g., california_tract_2020.csv)
    // - tract_STATE_YEAR.csv

    const patterns = [
      /^([A-Z]{2})_tract/i,                    // AZ_tract_2020.csv
      /^([a-z]+)_tract/i,                      // california_tract_2020.csv
      /tract_([a-z]{2})_/i,                    // tract_az_2020.csv
      /_([a-z]{2})_tract/i,                    // something_az_tract_2020.csv
      /tract_([A-Z]{2})\d/i                    // tract_AZ2020.csv
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        let stateCode = match[1].toUpperCase();

        // Handle full state names
        const stateNameMap = {
          'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
          'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
          'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
          'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
          'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
          'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
          'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
          'newhampshire': 'NH', 'newjersey': 'NJ', 'newmexico': 'NM', 'newyork': 'NY',
          'northcarolina': 'NC', 'northdakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
          'oregon': 'OR', 'pennsylvania': 'PA', 'rhodeisland': 'RI', 'southcarolina': 'SC',
          'southdakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
          'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'westvirginia': 'WV',
          'wisconsin': 'WI', 'wyoming': 'WY', 'districtofcolumbia': 'DC'
        };

        if (stateCode.length > 2) {
          stateCode = stateNameMap[stateCode.toLowerCase()] || stateCode;
        }

        // Validate it's a real state code
        const validStates = new Set([
          'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
          'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
          'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
          'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
          'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
        ]);

        return validStates.has(stateCode) ? stateCode : null;
      }
    }

    return null;
  }

  /**
   * Format bytes for display
   * @param {number} bytes - Number of bytes
   * @returns {string} - Formatted size string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get download status for a year
   * @param {number} year - Election year
   * @returns {Promise<Object>} - Status information
   */
  async getDownloadStatus(year = 2020) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      // Same canonical location as vest-data-loader: backend/data/vest/dataverse_files
      const vestDataDir = path.join(__dirname, '..', 'data', 'vest');
      const dataverseDir = path.join(vestDataDir, 'dataverse_files');

      const status = {
        year,
        tractFiles: [],
        totalSize: 0,
        lastDownload: null
      };

      try {
        const files = await fs.readdir(dataverseDir);

        for (const file of files) {
          if (this.isTractFile(file, year)) {
            const filePath = path.join(dataverseDir, file);
            const stats = await fs.stat(filePath);

            status.tractFiles.push({
              filename: file,
              size: stats.size,
              modified: stats.mtime
            });

            status.totalSize += stats.size;

            if (!status.lastDownload || stats.mtime > status.lastDownload) {
              status.lastDownload = stats.mtime;
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist or can't be read
        console.warn('Could not read VEST data directory:', error.message);
      }

      return status;

    } catch (error) {
      console.error('Error getting download status:', error.message);
      throw error;
    }
  }
}

module.exports = new VESTDataDownloader();