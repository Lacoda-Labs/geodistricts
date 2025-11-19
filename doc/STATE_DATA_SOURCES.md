# State Voter Registration Data Sources Tracking

This document tracks the status of voter registration party data sources for all 50 states + DC.

**Last Updated**: 2025-01-XX  
**Total States**: 51 (50 states + DC)  
**Configured**: 5  
**Needs Help**: 46

## Progress Overview

```
Progress: [████░░░░░░░░░░░░░░░░] 5/51 states (10%)
```

### Status Legend

- ✅ **Configured**: Data source identified and loader implemented
- 🟡 **In Progress**: Data source identified, loader being implemented
- 🔍 **Help Needed**: Need help finding data source
- ❌ **Not Available**: Data not available or too expensive

## State-by-State Status

### Configured States (5)

| State | Code | Data Source | Granularity | Format | Method | Status |
|-------|------|-------------|-------------|--------|--------|--------|
| Arizona | AZ | Arizona Secretary of State | County | CSV | Download | ✅ Configured |
| California | CA | California Secretary of State | Precinct | CSV | Manual | ✅ Configured |
| Florida | FL | Florida Division of Elections | County | CSV | Download | ✅ Configured |
| New York | NY | New York State Board of Elections | District | CSV | Download | ✅ Configured |
| Texas | TX | Texas Secretary of State | County | Excel | Download | ✅ Configured |

### States Needing Help (46)

#### Northeast Region

| State | Code | Status | Issue Link | Notes |
|-------|------|--------|------------|-------|
| Connecticut | CT | 🔍 Help Needed | - | - |
| Delaware | DE | 🔍 Help Needed | - | - |
| Maine | ME | 🔍 Help Needed | - | - |
| Maryland | MD | 🔍 Help Needed | - | - |
| Massachusetts | MA | 🔍 Help Needed | - | - |
| New Hampshire | NH | 🔍 Help Needed | - | - |
| New Jersey | NJ | 🔍 Help Needed | - | - |
| Pennsylvania | PA | 🔍 Help Needed | - | - |
| Rhode Island | RI | 🔍 Help Needed | - | - |
| Vermont | VT | 🔍 Help Needed | - | - |

#### Southeast Region

| State | Code | Status | Issue Link | Notes |
|-------|------|--------|------------|-------|
| Alabama | AL | 🔍 Help Needed | - | - |
| Arkansas | AR | 🔍 Help Needed | - | - |
| Georgia | GA | 🔍 Help Needed | - | - |
| Kentucky | KY | 🔍 Help Needed | - | - |
| Louisiana | LA | 🔍 Help Needed | - | - |
| Mississippi | MS | 🔍 Help Needed | - | - |
| North Carolina | NC | 🔍 Help Needed | - | - |
| South Carolina | SC | 🔍 Help Needed | - | - |
| Tennessee | TN | 🔍 Help Needed | - | - |
| Virginia | VA | 🔍 Help Needed | - | - |
| West Virginia | WV | 🔍 Help Needed | - | - |

#### Midwest Region

| State | Code | Status | Issue Link | Notes |
|-------|------|--------|------------|-------|
| Illinois | IL | 🔍 Help Needed | - | - |
| Indiana | IN | 🔍 Help Needed | - | - |
| Iowa | IA | 🔍 Help Needed | - | - |
| Kansas | KS | 🔍 Help Needed | - | - |
| Michigan | MI | 🔍 Help Needed | - | - |
| Minnesota | MN | 🔍 Help Needed | - | - |
| Missouri | MO | 🔍 Help Needed | - | - |
| Nebraska | NE | 🔍 Help Needed | - | - |
| North Dakota | ND | 🔍 Help Needed | - | - |
| Ohio | OH | 🔍 Help Needed | - | - |
| South Dakota | SD | 🔍 Help Needed | - | - |
| Wisconsin | WI | 🔍 Help Needed | - | - |

#### West Region

| State | Code | Status | Issue Link | Notes |
|-------|------|--------|------------|-------|
| Alaska | AK | 🔍 Help Needed | - | - |
| Colorado | CO | 🔍 Help Needed | - | - |
| Hawaii | HI | 🔍 Help Needed | - | - |
| Idaho | ID | 🔍 Help Needed | - | - |
| Montana | MT | 🔍 Help Needed | - | - |
| Nevada | NV | 🔍 Help Needed | - | - |
| New Mexico | NM | 🔍 Help Needed | - | - |
| Oklahoma | OK | 🔍 Help Needed | - | - |
| Oregon | OR | 🔍 Help Needed | - | - |
| Utah | UT | 🔍 Help Needed | - | - |
| Washington | WA | 🔍 Help Needed | - | - |
| Wyoming | WY | 🔍 Help Needed | - | - |

#### District of Columbia

| State | Code | Status | Issue Link | Notes |
|-------|------|--------|------------|-------|
| District of Columbia | DC | 🔍 Help Needed | - | - |

## Data Source Requirements

For each state, we need:

1. **Geographic Granularity**: Preferably precinct or tract level, but county level is acceptable
2. **Data Fields**: Total voters, Democratic, Republican, Other/Independent
3. **Format**: CSV, Excel, or API access preferred
4. **Cost**: Free or low-cost preferred (< $100 per state)
5. **Update Frequency**: At least annually, preferably quarterly or monthly

## How to Contribute

1. **Find a Data Source**: Research your state's election office website
2. **Create an Issue**: Use the [State Data Source Request template](.github/ISSUE_TEMPLATE/data-source-request.md)
3. **Share Information**: Provide links, formats, costs, and access methods
4. **Help Implement**: Optionally help implement the data loader (see [CONTRIBUTING.md](../CONTRIBUTING.md))

## Contributor Recognition

Contributors who help find or implement data sources will be recognized in:
- This document
- Project README
- GitHub contributors page
- Social media acknowledgments (with permission)

## Resources

- [Voter Registration Data Plan](VOTER_REGISTRATION_DATA_PLAN.md) - Detailed requirements and strategy
- [Contributing Guidelines](../CONTRIBUTING.md) - How to contribute to the project
- [State Election Offices Directory](https://www.eac.gov/voters/contact-your-state-election-office) - Official state election office contacts

## Notes

- This document is updated as new data sources are identified
- Status changes from "Help Needed" to "In Progress" when work begins
- Status changes to "Configured" when data loader is implemented and tested

