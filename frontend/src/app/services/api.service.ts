import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getHello(): Observable<any> {
    return this.http.get(`${this.apiUrl}/hello`);
  }

  getHealth(): Observable<any> {
    // Remove /api from the URL to get the base URL, then add /health
    const baseUrl = this.apiUrl.replace('/api', '');
    return this.http.get(`${baseUrl}/health`);
  }
}
