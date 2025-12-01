import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface State {
  code: string;
  name: string;
  districts: number;
}

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './page-header.component.html',
  styleUrls: ['./page-header.component.scss'],
})
export class PageHeaderComponent implements OnChanges {
  @Input() showStateSelector: boolean = false;
  @Input() states: State[] = [];
  @Input() selectedState: string = '';
  @Output() stateChange = new EventEmitter<string>();
  @Output() homeClick = new EventEmitter<void>();

  internalSelectedState: string = '';

  constructor(private router: Router, private route: ActivatedRoute) {
    // Initialize with empty state - will be set by input binding or ngOnChanges
    this.internalSelectedState = '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update internal state when input changes (e.g., when maps page loads and sets selectedState)
    if (changes['selectedState']) {
      const newValue = changes['selectedState'].currentValue;
      // Always sync with input value, even if it's empty
      this.internalSelectedState = newValue !== undefined && newValue !== null ? newValue : '';
    }
  }

  onStateChange(): void {
    // Use internal state for the change
    const stateValue = this.internalSelectedState;
    
    // Save state to localStorage so maps page can pick it up
    if (stateValue) {
      localStorage.setItem('selectedState', stateValue);
    } else {
      localStorage.removeItem('selectedState');
    }

    // Check if we're on the maps page
    const isOnMapsPage = this.router.url.includes('/maps');

    if (!isOnMapsPage && stateValue) {
      // Navigate to maps page - it will automatically load the state and run algorithm (if not "ALL")
      this.router.navigate(['/maps']);
    } else {
      // If already on maps page, just emit the change event
      this.stateChange.emit(stateValue);
    }
  }

  onHomeClick(): void {
    this.homeClick.emit();
  }
}

