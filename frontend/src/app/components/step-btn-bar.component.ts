import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-step-btn-bar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './step-btn-bar.component.html',
  styleUrls: ['./step-btn-bar.component.scss']
})
export class StepBtnBarComponent {
  @Input() variant: 'admin' | 'public' = 'admin';
  @Input() disabled: boolean = false;
  @Input() canGoToFirst: boolean = false;
  @Input() canGoToPrevious: boolean = false;
  @Input() canGoToNext: boolean = false;
  @Input() canGoToLast: boolean = false;
  @Input() isPlaying: boolean = false;
  @Input() currentStepIndex: number = 0;
  @Input() totalSteps: number = 0;

  @Output() firstStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();
  @Output() playPause = new EventEmitter<void>();
  @Output() nextStep = new EventEmitter<void>();
  @Output() lastStep = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() clearCache = new EventEmitter<void>();

  onFirstStep(): void {
    this.firstStep.emit();
  }

  onPreviousStep(): void {
    this.previousStep.emit();
  }

  onPlayPause(): void {
    this.playPause.emit();
  }

  onNextStep(): void {
    this.nextStep.emit();
  }

  onLastStep(): void {
    this.lastStep.emit();
  }

  onRestart(): void {
    this.restart.emit();
  }

  onClearCache(): void {
    this.clearCache.emit();
  }
}
