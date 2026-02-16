# Contributing to GeoDistricts

Thank you for your interest in contributing to GeoDistricts! This document provides guidelines and instructions for contributing to the project.

## Developer portal and archive

Archived AI pair-programming sessions (from `.cursor/archive/`) are published to the [GitHub Pages developer portal](https://lacoda-labs.github.io/geodistricts/archive/) for transparency. If you archive a chat, it may become public when the maintainer runs the sync script and commits `docs/archive/`. Do not include secrets or sensitive data in sessions you archive.

## How to Contribute

There are many ways to contribute to GeoDistricts:

1. **Finding Voter Registration Data Sources** - Help us locate data sources for all 50 states
2. **Implementing Data Loaders** - Write code to fetch and process state data
3. **Improving Documentation** - Help make our docs clearer and more comprehensive
4. **Reporting Bugs** - Help us identify and fix issues
5. **Feature Development** - Add new features or improve existing ones
6. **Testing** - Help ensure code quality through testing

## Protocol Changes

GeoDistricts is the **reference implementation** of the GeoDistricts Protocol. The protocol itself (GDIPs, governance, index) is maintained in a **separate repository** (see [Protocol Repository Recommendations](doc/protocol/PROTOCOL_REPO_RECOMMENDATIONS.md)).

- **Algorithm or data-model changes** that affect the protocol MUST be proposed in the **protocol repo** as a GeoDistricts Improvement Proposal (GDIP). Do not change the core algorithm or canonical data structures in this repo without a corresponding accepted GDIP.
- **This repo** tracks which protocol version (or GDIP set) it implements; see [Reference Implementation](doc/protocol/REFERENCE_IMPLEMENTATION.md).
- To contribute to the protocol (new or revised GDIPs), follow the [GDIP process](doc/protocol/process/GDIP-PROCESS.md) in the protocol repo once it exists; until then, GDIPs are maintained under `doc/protocol/GDIPs/` in this repo.
- After editing GDIPs or process docs in this repo, run **`./scripts/sync-gdip.sh`** to copy them into the nested `gdip/` repo, then commit and push from `gdip/` to publish to [Lacoda-Labs/gdip](https://github.com/Lacoda-Labs/gdip). See [Reference Implementation — Syncing to the GDIP repo](doc/protocol/REFERENCE_IMPLEMENTATION.md#syncing-to-the-gdip-repo).

## Voter Registration Data Contribution

### Current Priority: Finding Data Sources for All 50 States

We need help finding voter registration party data sources for all 50 states + DC. Currently, we have data sources for only 5 states.

### How to Help Find Data Sources

1. **Research Your State**
   - Visit your state's election office website
   - Look for voter registration statistics or data downloads
   - Check for API access or bulk data availability

2. **Create an Issue**
   - Use the [State Data Source Request template](.github/ISSUE_TEMPLATE/data-source-request.md)
   - Fill in all relevant information about the data source
   - Include links, formats, costs, and access methods

3. **What We Need**
   - Link to official data source
   - Data format (CSV, Excel, API, etc.)
   - Geographic granularity (precinct, county, etc.)
   - Cost information
   - Access method (download, API, request process)
   - Any restrictions or requirements

### Implementing Data Loaders

If you'd like to help implement a data loader for a state:

1. **Check Existing Implementation**
   - Review `backend/services/voter-registration-loader.js`
   - Look at existing state implementations (AZ, CA, FL, NY, TX)

2. **Create State-Specific Loader**
   - Add state configuration to `STATE_DATA_SOURCES` object
   - Implement fetch logic in `fetchVoterRegistrationData` method
   - Handle data normalization and validation

3. **Testing**
   - Test with sample data
   - Verify data format matches expected structure
   - Ensure geographic identifiers are correct

4. **Submit Pull Request**
   - Include tests if applicable
   - Update documentation
   - Update `doc/STATE_DATA_SOURCES.md` with status

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Getting Started

1. **Fork the Repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/geodistricts.git
   cd geodistricts
   ```

2. **Install Dependencies**
   ```bash
   # Backend
   cd backend
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Make Changes**
   - Write your code
   - Add tests if applicable
   - Update documentation

5. **Test Your Changes**
   ```bash
   # Backend tests
   cd backend
   npm test
   
   # Frontend tests
   cd ../frontend
   npm test
   ```

6. **Submit a Pull Request**
   - Push your branch to your fork
   - Create a pull request on GitHub
   - Fill out the PR template
   - Link any related issues

## Code Style

- Follow existing code style and patterns
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small
- Write self-documenting code when possible

## Commit Messages

Use clear, descriptive commit messages:

```
feat: Add voter registration loader for [STATE]
fix: Correct data normalization for county-level data
docs: Update STATE_DATA_SOURCES.md with new status
test: Add tests for [STATE] data loader
```

## Pull Request Process

1. **Update Documentation**
   - Update relevant documentation files
   - Update `doc/STATE_DATA_SOURCES.md` if adding a state
   - Add/update code comments

2. **Test Your Changes**
   - Ensure all tests pass
   - Test manually if applicable
   - Verify no breaking changes

3. **Create Pull Request**
   - Use a descriptive title
   - Fill out the PR template
   - Link related issues
   - Request review from maintainers

4. **Respond to Feedback**
   - Address review comments
   - Make requested changes
   - Keep the conversation constructive

## Data Source Requirements

When contributing data sources, ensure they meet these requirements:

### Geographic Granularity (in order of preference)
1. Census tract level (ideal)
2. Precinct level (preferred)
3. Census block level
4. County level (acceptable as fallback)

### Required Data Fields
- Total registered voters
- Democratic registered voters
- Republican registered voters
- Other/Independent registered voters
- Date of data snapshot
- Geographic identifier (FIPS code, GEOID, or spatial boundary)

### Format Preferences
- CSV (preferred)
- Excel
- API access
- JSON

### Cost Considerations
- Free (preferred)
- Low cost (< $100)
- Moderate cost ($100-$1,000) - evaluate case-by-case
- High cost (> $1,000) - consider alternatives

## Questions?

- Check our [documentation](doc/)
- Open a [GitHub Discussion](https://github.com/Lacoda-Labs/geodistricts/discussions)
- Create an issue for questions or problems

## Contributor Recognition

Contributors will be recognized in:
- Project README
- GitHub contributors page
- `doc/STATE_DATA_SOURCES.md`
- Social media acknowledgments (with permission)

Thank you for contributing to GeoDistricts!

