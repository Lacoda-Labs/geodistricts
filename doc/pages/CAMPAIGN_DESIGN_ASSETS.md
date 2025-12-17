# Campaign Design Assets

This document describes the visual assets needed for the social media campaign and provides text-based specifications and ASCII/markdown alternatives.

## Required Visual Assets

### 1. Progress Infographic

**Purpose**: Show current state coverage (5 states configured vs 50 needed)

**Specifications**:
- Title: "Voter Registration Data Progress"
- Subtitle: "Help us reach 50/50 states"
- Current: 5 states configured (highlighted)
- Needed: 45 states (grayed out)
- Progress bar: 10% complete
- Call to action: "Find data for your state"

**Markdown Alternative**:
```markdown
# Voter Registration Data Progress

## Help us reach 50/50 states

```
Progress: [████░░░░░░░░░░░░░░░░] 5/51 states (10%)
```

✅ Configured: 5 states (AZ, CA, FL, NY, TX)
🔍 Help Needed: 46 states

[Find data for your state →](link)
```

### 2. State-by-State Progress Map

**Purpose**: Visual tracker showing which states are configured, in progress, or need help

**Specifications**:
- US map with state boundaries
- Color coding:
  - Green: Configured (5 states)
  - Yellow: In Progress
  - Gray: Help Needed (46 states)
- Interactive: Clickable states linking to GitHub issues
- Legend explaining color codes

**Markdown Alternative**:
```markdown
# State-by-State Progress Map

## Status Legend
- ✅ Configured (5): AZ, CA, FL, NY, TX
- 🟡 In Progress (0)
- 🔍 Help Needed (46)

## Regional Breakdown

### Northeast (10 states)
- CT 🔍 | DE 🔍 | ME 🔍 | MD 🔍 | MA 🔍
- NH 🔍 | NJ 🔍 | NY ✅ | PA 🔍 | RI 🔍 | VT 🔍

### Southeast (11 states)
- AL 🔍 | AR 🔍 | FL ✅ | GA 🔍 | KY 🔍
- LA 🔍 | MS 🔍 | NC 🔍 | SC 🔍 | TN 🔍
- VA 🔍 | WV 🔍

### Midwest (12 states)
- IL 🔍 | IN 🔍 | IA 🔍 | KS 🔍 | MI 🔍
- MN 🔍 | MO 🔍 | NE 🔍 | ND 🔍 | OH 🔍
- SD 🔍 | WI 🔍

### West (12 states)
- AK 🔍 | AZ ✅ | CO 🔍 | CA ✅ | HI 🔍
- ID 🔍 | MT 🔍 | NV 🔍 | NM 🔍 | OK 🔍
- OR 🔍 | UT 🔍 | WA 🔍 | WY 🔍

### District of Columbia
- DC 🔍

[View detailed status →](doc/STATE_DATA_SOURCES.md)
```

### 3. "How to Help" Guide Graphic

**Purpose**: Quick visual guide showing how people can contribute

**Specifications**:
- Title: "How You Can Help"
- Steps:
  1. Research your state's election office
  2. Find voter registration data source
  3. Create GitHub issue with information
  4. (Optional) Help implement data loader
- Visual icons for each step
- Links to resources

**Markdown Alternative**:
```markdown
# How You Can Help

## 4 Simple Steps

### 1. 🔍 Research Your State
Visit your state's election office website and look for voter registration statistics.

### 2. 📊 Find Data Source
Look for:
- Voter registration statistics
- Party affiliation data
- Download links or API access
- Cost information

### 3. 📝 Create GitHub Issue
Use our [State Data Source Request template](.github/ISSUE_TEMPLATE/data-source-request.md) and share what you found.

### 4. 💻 (Optional) Help Implement
If you're a developer, help us implement the data loader for your state.

[Get Started →](CONTRIBUTING.md)
```

### 4. Social Media Graphics

#### Twitter Header Image
- Dimensions: 1500x500px
- Content: GeoDistricts logo + "Help us reach 50/50 states" + progress indicator
- Brand colors: Use project colors if available

#### Instagram Post Template
- Square format: 1080x1080px
- Title: "Help Needed: Voter Registration Data"
- Progress visualization
- Call to action
- QR code to GitHub (optional)

#### LinkedIn Banner
- Dimensions: 1128x191px
- Professional design
- Progress indicator
- Link to project

**Text Specifications for Designer**:
```
Twitter Header (1500x500px):
- Background: [Project brand color or gradient]
- Logo: GeoDistricts logo (top left)
- Main text: "Help us reach 50/50 states"
- Progress: "5/50 states configured (10%)"
- CTA: "Find data for your state"
- GitHub link: [URL]

Instagram Post (1080x1080px):
- Title: "Help Needed: Voter Registration Data"
- Progress bar visualization
- State map with color coding
- Steps to help
- GitHub QR code (bottom right)

LinkedIn Banner (1128x191px):
- Professional gradient background
- Logo and project name
- Progress: "5/50 states"
- Subtle call to action
```

### 5. Progress Badge/Shield

**Purpose**: GitHub README badge showing campaign progress

**Markdown**:
```markdown
![Voter Data Progress](https://img.shields.io/badge/Voter%20Data-5%2F50%20states-10%25-brightgreen)
```

**Shield.io URL**:
```
https://img.shields.io/badge/Voter%20Data-5%2F50%20states-10%25-brightgreen
```

### 6. Contributor Recognition Graphic

**Purpose**: Celebrate contributors and encourage more participation

**Specifications**:
- Title: "Thank You, Contributors!"
- List of contributor names/usernames
- States they helped with
- "Join them!" call to action

**Markdown Alternative**:
```markdown
# Thank You, Contributors! 🙏

## Recent Contributors
- @[username] - Found data for [State]
- @[username] - Implemented loader for [State]
- @[username] - Updated documentation

## Join Them!
Help us reach 50/50 states. [Get started →](CONTRIBUTING.md)
```

## ASCII Art Alternatives

### Progress Bar
```
Progress: [████░░░░░░░░░░░░░░░░] 5/51 (10%)
```

### State Grid
```
Northeast:  CT🔍 DE🔍 ME🔍 MD🔍 MA🔍 NH🔍 NJ🔍 NY✅ PA🔍 RI🔍 VT🔍
Southeast:  AL🔍 AR🔍 FL✅ GA🔍 KY🔍 LA🔍 MS🔍 NC🔍 SC🔍 TN🔍 VA🔍 WV🔍
Midwest:    IL🔍 IN🔍 IA🔍 KS🔍 MI🔍 MN🔍 MO🔍 NE🔍 ND🔍 OH🔍 SD🔍 WI🔍
West:       AK🔍 AZ✅ CO🔍 CA✅ HI🔍 ID🔍 MT🔍 NV🔍 NM🔍 OK🔍 OR🔍 UT🔍 WA🔍 WY🔍
DC:         DC🔍
```

### Simple Map Representation
```
                    AK🔍
                    
WA🔍  MT🔍  ND🔍  MN🔍  WI🔍  MI🔍  NY✅  VT🔍  ME🔍
OR🔍  ID🔍  WY🔍  SD🔍  IA🔍  IL🔍  PA🔍  NH🔍
CA✅  NV🔍  UT🔍  CO🔍  NE🔍  MO🔍  KY🔍  VA🔍
AZ✅  NM🔍  KS🔍  OK🔍  AR🔍  TN🔍  NC🔍  SC🔍
      TX✅  LA🔍  MS🔍  AL🔍  GA🔍
            FL✅
                    HI🔍
```

## Design Guidelines

### Colors
- **Success/Configured**: Green (#28a745 or similar)
- **In Progress**: Yellow/Orange (#ffc107 or similar)
- **Help Needed**: Gray (#6c757d or similar)
- **Primary Brand**: Use project brand colors
- **Accent**: Blue for links and CTAs

### Typography
- **Headings**: Bold, clear, readable
- **Body**: Standard sans-serif (Arial, Helvetica, or project font)
- **Code/Data**: Monospace font for technical information

### Icons
- Use emoji for quick visual communication:
  - ✅ Configured
  - 🟡 In Progress
  - 🔍 Help Needed
  - 📊 Data/Statistics
  - 💻 Development
  - 🙏 Thank You

### Layout Principles
- Keep it simple and scannable
- Use clear hierarchy
- Include call-to-action buttons
- Make links obvious
- Ensure mobile-friendly design

## Implementation Notes

1. **For GitHub**: Use markdown with emoji and progress bars
2. **For Social Media**: Create actual graphics using design tools
3. **For Website**: Can use SVG or CSS-based progress indicators
4. **For Documentation**: Markdown with ASCII art works well

## Tools for Creating Graphics

- **Canva**: Free templates for social media graphics
- **Figma**: Professional design tool
- **GIMP/Photoshop**: Advanced image editing
- **Shields.io**: Badge generation
- **ASCII Art Generators**: For text-based visuals

## File Naming Convention

- `campaign-progress-infographic.png`
- `state-progress-map.png`
- `how-to-help-guide.png`
- `social-twitter-header.png`
- `social-instagram-post.png`
- `social-linkedin-banner.png`
- `contributor-recognition.png`

Store in: `/doc/campaign-assets/` or `/public/images/campaign/`

