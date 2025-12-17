# Division Boxes Component

## Overview

The Division Boxes component (`division-boxes.component`) provides a visual representation of the geodistricting algorithm's recursive division process. It displays the hierarchical breakdown of districts from the initial state (e.g., 52 districts for California) down to individual geodistricts (single districts), showing each step of the division process as animated boxes.

## Purpose

This component helps users understand the mathematical process behind district division by visualizing:
- How large district groups are recursively divided into smaller groups
- The direction of each division (latitude/horizontal or longitude/vertical)
- When district groups become complete (single districts, shown in green)
- The progression through all algorithm steps

## Component Structure

### Files
- `division-boxes.component.ts` - Component logic and visualization engine
- `division-boxes.component.html` - Template with box rendering
- `division-boxes.component.scss` - Styling and animations

### Key Interfaces

```typescript
interface BoxNode {
  id: string;
  districtCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  isComplete: boolean;
  children: BoxNode[];
  parent?: BoxNode;
  divisionDirection?: 'latitude' | 'longitude';
  divisionRatio?: [number, number];
  districtRange?: { start: number; end: number };
}
```

## Behavior

### Initial State (Step 0)
- Displays a single box at the top level containing the total number of districts
- For California, this would show "52" in a light blue box

### Division Process

1. **Tree Building**: The component builds a hierarchical tree structure from the algorithm steps:
   - Each step's district groups are mapped to parent groups from the previous step
   - Child boxes are created for each division
   - District ranges are tracked to maintain proper parent-child relationships

2. **Position Calculation**: 
   - Boxes are positioned in a grid layout
   - Each level (step) is displayed on a separate row
   - Boxes within a level are evenly spaced horizontally
   - The component scales to fit the container (`.map-container`)

3. **Division Line Animation**:
   - When a step is displayed, red division lines animate over parent boxes
   - **Latitude division**: Horizontal red line animates left-to-right
   - **Longitude division**: Vertical red line animates top-to-bottom
   - Animation duration: 1.5 seconds
   - Lines pulse during animation

4. **Box Rendering**:
   - Each box displays the number of districts in that group
   - Font size scales with box size (30% of box width/height, min 10px)
   - **Light blue boxes**: District groups with more than 1 district
   - **Green boxes**: Complete geodistricts (single districts, `totalDistricts === 1`)
   - Boxes have hover effects (scale and shadow)

### Step Navigation

- Uses the same step navigation as the map view (Prev/Next buttons)
- Component receives `currentStep`, `currentStepIndex`, and `allSteps` as inputs
- Only displays boxes up to the current step index
- Division lines animate when a new step is reached

## Integration

### Maps Page Integration

The component is integrated into the maps page (`maps-page.component`) and can be toggled via a "math" checkbox:

```html
<mat-checkbox [(ngModel)]="showMathView" (change)="onMathViewChange()">
  math
</mat-checkbox>
```

When `showMathView` is `true`:
- The map is hidden
- The division boxes component is displayed in its place
- The component fills the `.map-container` area

### Step Explanation

When the math view is active, the info section displays a simple explanation of the current step:

- **Step 0**: "Initial state: X districts to divide."
- **Other steps**: "Step N: Dividing X district group(s) [horizontally/vertically] into Y total districts."

## Visual Design

### Colors
- **Light Blue (#ADD8E6)**: Incomplete district groups
- **Light Green (#90EE90)**: Complete geodistricts (single districts)
- **Red (#ff0000)**: Division lines
- **Dark Green (#006400)**: Border for complete districts

### Layout
- Hierarchical grid layout
- Top row: Initial state (single box)
- Subsequent rows: Divided groups from each step
- Responsive sizing based on container dimensions

### Animations
- Division lines animate from 0% to 100% progress
- Line pulse effect during animation
- Box hover effects (scale and shadow)
- Smooth transitions for color changes

## Technical Details

### Tree Building Algorithm

1. **Root Node Creation**: Creates initial box from step 0
2. **Step Processing**: For each subsequent step:
   - Maps new district groups to parent groups using district number ranges
   - Creates child boxes for each division
   - Maintains parent-child relationships
3. **Position Calculation**: 
   - Calculates positions after tree is built
   - Distributes boxes evenly within each level
   - Scales to container size

### Division Line Animation

- Uses `requestAnimationFrame` for smooth animation
- Tracks progress from 0 to 1 over 1.5 seconds
- Updates line dimensions based on direction:
  - Latitude: Width increases (left to right)
  - Longitude: Height increases (top to bottom)

### Responsive Sizing

- Font size: `Math.max(10, Math.min(width * 0.3, height * 0.3))`
- Box spacing: `availableWidth / (boxes.length + 1)`
- Level height: `availableHeight / (maxLevel + 1)`
- Minimum box size: 40px

## Usage Example

```typescript
<app-division-boxes
  [currentStep]="currentStep"
  [currentStepIndex]="currentStepIndex"
  [allSteps]="getAllSteps()">
</app-division-boxes>
```

## Future Enhancements

Potential improvements:
- Interactive box selection to highlight corresponding map districts
- Zoom/pan controls for large state visualizations
- Export visualization as image
- Animation speed controls
- Show division ratios on boxes
- Highlight parent-child relationships with connecting lines

