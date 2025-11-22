import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeodistrictStep, DistrictGroup, DivisionLineInfo } from '../services/geodistrict-algorithm.service';

interface BoxNode {
  id: string;
  districtCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  isComplete: boolean; // true when totalDistricts === 1
  children: BoxNode[];
  parent?: BoxNode;
  divisionDirection?: 'latitude' | 'longitude';
  districtRange?: { start: number; end: number };
  gridPosition?: { row: number; col: number }; // Position in grid layout
}

interface DivisionLine {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'latitude' | 'longitude';
  progress: number;
  parentBoxId: string;
}

@Component({
  selector: 'app-division-boxes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './division-boxes.component.html',
  styleUrls: ['./division-boxes.component.scss']
})
export class DivisionBoxesComponent implements OnChanges, AfterViewInit {
  @Input() currentStep: GeodistrictStep | null = null;
  @Input() currentStepIndex: number = 0;
  @Input() allSteps: GeodistrictStep[] = [];

  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  boxTree: BoxNode[] = [];
  animatedDivisionLines: DivisionLine[] = [];
  visibleBoxes: BoxNode[] = []; // Boxes to display up to current step

  private gridLayout: Map<number, BoxNode[]> = new Map(); // level -> boxes at that level
  private containerWidth: number = 0;
  private containerHeight: number = 0;
  private readonly padding = 20;
  private readonly boxGap = 10; // Gap between boxes
  private readonly minBoxSize = 50;
  private readonly maxBoxSize = 200;

  ngAfterViewInit(): void {
    this.updateContainerSize();
    this.buildVisualization();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentStep'] || changes['currentStepIndex'] || changes['allSteps']) {
      this.updateContainerSize();
      this.buildVisualization();
    }
  }

  private updateContainerSize(): void {
    if (this.containerRef?.nativeElement) {
      this.containerWidth = this.containerRef.nativeElement.offsetWidth;
      this.containerHeight = this.containerRef.nativeElement.offsetHeight;
    }
  }

  private buildVisualization(): void {
    if (!this.allSteps || this.allSteps.length === 0) {
      this.boxTree = [];
      this.visibleBoxes = [];
      this.animatedDivisionLines = [];
      return;
    }

    // Build the tree structure from all steps
    this.buildTree();
    
    // Calculate positions for all boxes in grid layout
    this.calculateGridPositions();
    
    // Determine which boxes are visible up to current step
    this.updateVisibleBoxes();
    
    // Animate division lines for current step
    this.animateCurrentStep();
  }

  private buildTree(): void {
    this.boxTree = [];
    this.gridLayout.clear();

    if (!this.allSteps || this.allSteps.length === 0) return;

    // Step 0: Initial state - single box with total districts
    const initialStep = this.allSteps[0];
    if (!initialStep || !initialStep.districtGroups || initialStep.districtGroups.length === 0) return;

    const totalDistricts = initialStep.districtGroups.reduce((sum, group) => sum + group.totalDistricts, 0);
    const firstGroup = initialStep.districtGroups[0];
    const lastGroup = initialStep.districtGroups[initialStep.districtGroups.length - 1];
    
    const rootNode: BoxNode = {
      id: 'root-0',
      districtCount: totalDistricts,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      level: 0,
      isComplete: totalDistricts === 1,
      children: [],
      districtRange: {
        start: firstGroup.startDistrictNumber,
        end: lastGroup.endDistrictNumber
      },
      gridPosition: { row: 0, col: 0 }
    };

    this.boxTree.push(rootNode);
    this.addToGridLayout(0, rootNode);

    // Build tree from subsequent steps
    for (let stepIdx = 1; stepIdx < this.allSteps.length; stepIdx++) {
      const step = this.allSteps[stepIdx];
      const prevStep = this.allSteps[stepIdx - 1];
      
      this.processStepDivision(step, prevStep, stepIdx);
    }
  }

  private processStepDivision(step: GeodistrictStep, prevStep: GeodistrictStep, stepIdx: number): void {
    const parentBoxes = this.gridLayout.get(stepIdx - 1) || [];
    const newGroups = step.districtGroups || [];
    const prevGroups = prevStep.districtGroups || [];

    // Create a mapping from previous groups to new groups
    const groupMapping = this.mapGroupsToParents(prevGroups, newGroups);

    // For each parent box, create child boxes
    parentBoxes.forEach((parentBox, parentIdx) => {
      if (parentBox.districtCount > 1) {
        // Find which groups correspond to this parent
        let correspondingGroups: DistrictGroup[] = [];
        
        if (parentBox.districtRange) {
          const parentKey = `group-${parentBox.districtRange.start}-${parentBox.districtRange.end}`;
          correspondingGroups = groupMapping.get(parentKey) || [];
        } else {
          // Fallback for root node
          const prevGroups = prevStep.districtGroups || [];
          if (prevGroups.length === 1 && prevGroups[0].totalDistricts === parentBox.districtCount) {
            const parentKey = `group-${prevGroups[0].startDistrictNumber}-${prevGroups[0].endDistrictNumber}`;
            correspondingGroups = groupMapping.get(parentKey) || [];
          }
        }
        
        if (correspondingGroups.length > 0) {
          // Create child boxes
          const children: BoxNode[] = correspondingGroups.map((group, idx) => {
            const childId = `${parentBox.id}-child-${idx}`;
            return {
              id: childId,
              districtCount: group.totalDistricts,
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              level: stepIdx,
              isComplete: group.totalDistricts === 1,
              children: [],
              parent: parentBox,
              divisionDirection: step.divisionDirection,
              districtRange: {
                start: group.startDistrictNumber,
                end: group.endDistrictNumber
              },
              gridPosition: { row: stepIdx, col: 0 } // Will be calculated later
            };
          });

          parentBox.children = children;
          children.forEach(child => {
            this.boxTree.push(child);
            this.addToGridLayout(stepIdx, child);
          });
        }
      }
    });
  }

  private mapGroupsToParents(prevGroups: DistrictGroup[], newGroups: DistrictGroup[]): Map<string, DistrictGroup[]> {
    const mapping = new Map<string, DistrictGroup[]>();

    prevGroups.forEach(prevGroup => {
      const matchingGroups = newGroups.filter(newGroup => {
        return newGroup.startDistrictNumber >= prevGroup.startDistrictNumber &&
               newGroup.endDistrictNumber <= prevGroup.endDistrictNumber;
      });

      if (matchingGroups.length > 0) {
        matchingGroups.sort((a, b) => a.startDistrictNumber - b.startDistrictNumber);
        mapping.set(`group-${prevGroup.startDistrictNumber}-${prevGroup.endDistrictNumber}`, matchingGroups);
      }
    });

    return mapping;
  }

  private addToGridLayout(level: number, box: BoxNode): void {
    if (!this.gridLayout.has(level)) {
      this.gridLayout.set(level, []);
    }
    this.gridLayout.get(level)!.push(box);
  }

  private calculateGridPositions(): void {
    if (this.containerWidth === 0 || this.containerHeight === 0) return;

    const maxLevel = Math.max(...Array.from(this.gridLayout.keys()), 0);
    const availableWidth = this.containerWidth - (this.padding * 2);
    const availableHeight = this.containerHeight - (this.padding * 2);

    // Calculate positions for each level (row)
    for (let level = 0; level <= maxLevel; level++) {
      const boxes = this.gridLayout.get(level) || [];
      if (boxes.length === 0) continue;

      // Calculate row height - distribute evenly but make room for more boxes at lower levels
      const levelHeight = availableHeight / (maxLevel + 1);
      const boxHeight = Math.min(Math.max(levelHeight * 0.7, this.minBoxSize), this.maxBoxSize);
      
      // Calculate box width based on number of boxes in this level
      const totalGapWidth = this.boxGap * (boxes.length - 1);
      const availableBoxWidth = availableWidth - totalGapWidth;
      const boxWidth = Math.min(
        Math.max(availableBoxWidth / boxes.length, this.minBoxSize),
        this.maxBoxSize
      );

      // Calculate starting x position to center boxes
      const totalBoxesWidth = (boxWidth * boxes.length) + (this.boxGap * (boxes.length - 1));
      const startX = this.padding + (availableWidth - totalBoxesWidth) / 2;

      // Position each box
      boxes.forEach((box, idx) => {
        box.x = startX + (idx * (boxWidth + this.boxGap));
        box.y = this.padding + (level * levelHeight) + (levelHeight - boxHeight) / 2;
        box.width = boxWidth;
        box.height = boxHeight;
        if (box.gridPosition) {
          box.gridPosition.col = idx;
        }
      });
    }
  }

  private updateVisibleBoxes(): void {
    // Show all boxes up to and including the current step
    this.visibleBoxes = [];
    
    for (let level = 0; level <= this.currentStepIndex; level++) {
      const boxes = this.gridLayout.get(level) || [];
      this.visibleBoxes.push(...boxes);
    }
  }

  private animateCurrentStep(): void {
    this.animatedDivisionLines = [];

    if (!this.currentStep || this.currentStepIndex === 0) return;

    const prevStep = this.allSteps[this.currentStepIndex - 1];
    if (!prevStep) return;

    // Find boxes from previous step that are being divided
    const parentBoxes = this.gridLayout.get(this.currentStepIndex - 1) || [];

    parentBoxes.forEach(parentBox => {
      if (parentBox.districtCount > 1 && parentBox.children.length > 0) {
        const direction = this.currentStep!.divisionDirection || 'latitude';
        
        // Create division line animation
        const divisionLine: DivisionLine = {
          id: `line-${parentBox.id}`,
          x: parentBox.x,
          y: parentBox.y,
          width: direction === 'latitude' ? parentBox.width : 2,
          height: direction === 'longitude' ? parentBox.height : 2,
          direction: direction,
          progress: 0,
          parentBoxId: parentBox.id
        };

        // Animate the line
        this.animateDivisionLine(divisionLine);
      }
    });
  }

  private animateDivisionLine(line: DivisionLine): void {
    this.animatedDivisionLines.push({ ...line, progress: 0 });

    // Animate progress from 0 to 1
    const duration = 1500; // 1.5 seconds
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const lineIndex = this.animatedDivisionLines.findIndex(l => l.id === line.id);
      if (lineIndex >= 0) {
        this.animatedDivisionLines[lineIndex].progress = progress;
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  getBoxStyle(box: BoxNode): any {
    // Calculate font size based on box size - scale with container
    const fontSize = Math.max(12, Math.min(box.width * 0.25, box.height * 0.3));
    
    return {
      position: 'absolute',
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      fontSize: `${fontSize}px`,
      backgroundColor: box.isComplete ? '#90EE90' : '#ADD8E6', // Green if complete, light blue otherwise
      border: '2px solid #333',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      color: '#000',
      borderRadius: '4px',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      transition: 'background-color 0.3s ease, transform 0.2s ease'
    };
  }

  getDivisionLineStyle(line: DivisionLine): any {
    // Find the parent box to get its current position
    const parentBox = this.visibleBoxes.find(b => b.id === line.parentBoxId);
    if (!parentBox) {
      return { display: 'none' };
    }

    if (line.direction === 'latitude') {
      // Horizontal line (left to right)
      const width = parentBox.width * line.progress;
      return {
        position: 'absolute',
        left: `${parentBox.x}px`,
        top: `${parentBox.y + (parentBox.height / 2) - 1}px`,
        width: `${width}px`,
        height: '2px',
        backgroundColor: '#ff0000',
        zIndex: 10,
        transition: 'none',
        boxShadow: '0 0 4px rgba(255, 0, 0, 0.5)'
      };
    } else {
      // Vertical line (top to bottom)
      const height = parentBox.height * line.progress;
      return {
        position: 'absolute',
        left: `${parentBox.x + (parentBox.width / 2) - 1}px`,
        top: `${parentBox.y}px`,
        width: '2px',
        height: `${height}px`,
        backgroundColor: '#ff0000',
        zIndex: 10,
        transition: 'none',
        boxShadow: '0 0 4px rgba(255, 0, 0, 0.5)'
      };
    }
  }

  getStepExplanation(): string {
    if (!this.currentStep) return '';

    const stepNum = this.currentStep.step;
    const direction = this.currentStep.divisionDirection || 'unknown';
    const groups = this.currentStep.totalGroups || 0;
    const districts = this.currentStep.totalDistricts || 0;

    if (stepNum === 0) {
      return `Initial state: ${districts} districts to divide.`;
    }

    const directionText = direction === 'latitude' ? 'horizontally (left to right)' : 'vertically (top to bottom)';
    return `Step ${stepNum}: Dividing ${groups} district group${groups !== 1 ? 's' : ''} ${directionText} into ${districts} total districts.`;
  }
}
