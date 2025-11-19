#!/usr/bin/env node

/**
 * Generate GitHub issue content for each state
 * This script creates markdown files that can be used to create GitHub issues
 * for each state that needs voter registration data.
 */

const fs = require('fs');
const path = require('path');

const STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, // Configured
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, // Configured
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, // Configured
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, // Configured
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, // Configured
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' }
];

const CONFIGURED_STATES = ['AZ', 'CA', 'FL', 'NY', 'TX'];

function generateIssueContent(state) {
  const isConfigured = CONFIGURED_STATES.includes(state.code);
  
  if (isConfigured) {
    return null; // Skip configured states
  }

  const issueTitle = `[${state.code}] ${state.name} Voter Registration Data Source Needed`;
  
  const issueBody = `🚨 Help Needed: ${state.name} Voter Registration Data

We need help finding voter registration party data for **${state.name}**!

## Requirements

- **Granularity**: Precinct or county level (preferably precinct)
- **Data needed**: Total voters, Democratic, Republican, Other/Independent
- **Format**: CSV, Excel, or API access
- **Cost**: Free or low-cost preferred

## What We Need

- [ ] Link to state election office data source
- [ ] Data format and access method
- [ ] Any known costs or restrictions
- [ ] Help implementing data loader (optional)

## Resources

- State Election Office: [Link if known - check https://www.eac.gov/voters/contact-your-state-election-office]
- See our [data plan](doc/VOTER_REGISTRATION_DATA_PLAN.md) for detailed requirements
- Check [state tracking](doc/STATE_DATA_SOURCES.md) for current status

## Contributor Recognition

Contributors who help will be recognized in our project documentation and social media (with permission).

**Status**: 🔍 Help Needed

---

**Labels**: \`help-wanted\`, \`data\`, \`voter-registration\`, \`${state.code.toLowerCase()}\`
`;

  return {
    title: issueTitle,
    body: issueBody,
    state: state.code,
    stateName: state.name
  };
}

function main() {
  const outputDir = path.join(__dirname, '..', '.github', 'state-issues');
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const issues = [];
  const configuredCount = CONFIGURED_STATES.length;
  const totalStates = STATES.length;
  const needsHelpCount = totalStates - configuredCount;

  console.log(`Generating issue content for ${needsHelpCount} states...`);
  console.log(`(Skipping ${configuredCount} already configured states: ${CONFIGURED_STATES.join(', ')})`);
  console.log('');

  STATES.forEach(state => {
    const issue = generateIssueContent(state);
    
    if (issue) {
      issues.push(issue);
      
      // Write individual issue file
      const filename = `${state.code}-${state.name.replace(/\s+/g, '-')}.md`;
      const filepath = path.join(outputDir, filename);
      
      const fileContent = `# ${issue.title}\n\n${issue.body}`;
      fs.writeFileSync(filepath, fileContent, 'utf8');
      
      console.log(`✓ Generated: ${filename}`);
    }
  });

  // Create summary file
  const summaryPath = path.join(outputDir, 'README.md');
  const summaryContent = `# State-Specific Issue Templates

This directory contains GitHub issue templates for each state that needs voter registration data.

## Summary

- **Total States**: ${totalStates}
- **Configured**: ${configuredCount} states
- **Help Needed**: ${needsHelpCount} states

## Configured States (${configuredCount})

${CONFIGURED_STATES.map(code => {
  const state = STATES.find(s => s.code === code);
  return `- ✅ ${state.name} (${code})`;
}).join('\n')}

## States Needing Help (${needsHelpCount})

${issues.map(issue => `- [ ] ${issue.stateName} (${issue.state}) - \`${issue.state}-${issue.stateName.replace(/\s+/g, '-')}.md\``).join('\n')}

## How to Use

1. Copy the content from a state's markdown file
2. Go to GitHub Issues
3. Click "New Issue"
4. Paste the content
5. Add appropriate labels
6. Submit the issue

## Notes

- These templates are generated automatically
- Update the state election office link if known
- Customize the content as needed for each state
- Link to the main campaign issue when creating

## Related

- [Main Campaign Issue](../MAIN_CAMPAIGN_ISSUE.md)
- [State Data Sources Tracking](../../doc/STATE_DATA_SOURCES.md)
- [Issue Template](../../ISSUE_TEMPLATE/data-source-request.md)
`;

  fs.writeFileSync(summaryPath, summaryContent, 'utf8');
  console.log('');
  console.log(`✓ Generated summary: README.md`);
  console.log('');
  console.log(`Total issues generated: ${issues.length}`);
  console.log(`Output directory: ${outputDir}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Review the generated issue files');
  console.log('2. Create GitHub issues using these templates');
  console.log('3. Update state-specific information (e.g., election office links)');
}

if (require.main === module) {
  main();
}

module.exports = { generateIssueContent, STATES, CONFIGURED_STATES };

