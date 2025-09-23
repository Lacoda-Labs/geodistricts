import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class AppComponent implements OnInit {
  title = 'GeoDistricts';
  apiMessage = '';
  healthStatus = '';

  constructor(private apiService: ApiService) {}

  ngOnInit() {
    this.testApiConnection();
  }

  testApiConnection() {
    this.apiService.getHello().subscribe({
      next: (response) => {
        this.apiMessage = response.message;
      },
      error: (error) => {
        this.apiMessage = 'API connection failed';
        console.error('API Error:', error);
      }
    });

    this.apiService.getHealth().subscribe({
      next: (response) => {
        this.healthStatus = response.status;
      },
      error: (error) => {
        this.healthStatus = 'Health check failed';
        console.error('Health Check Error:', error);
      }
    });
  }
}
