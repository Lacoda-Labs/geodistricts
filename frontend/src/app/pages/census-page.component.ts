import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CensusTractViewerComponent } from '../components/census-tract-viewer.component';

@Component({
  selector: 'app-census-page',
  standalone: true,
  imports: [CommonModule, RouterModule, CensusTractViewerComponent],
  template: `
    <div class="census-page">
      <div class="page-header">
        <div class="breadcrumb">
          <a routerLink="/">Home</a>
          <span class="separator">›</span>
          <span class="current">Census Data</span>
        </div>
        
        <h1>Census Tract Data Explorer</h1>
        <p class="page-description">
          Explore detailed demographic and socioeconomic data for census tracts across the United States. 
          This tool helps analyze population characteristics essential for fair districting and policy planning.
        </p>
      </div>

      <div class="page-content">
        <div class="info-section">
          <div class="info-card">
            <h3>📊 What is Census Tract Data?</h3>
            <p>
              Census tracts are small, relatively permanent statistical subdivisions of a county or equivalent entity. 
              They typically contain between 1,200 and 8,000 people, with an optimum size of 4,000 people.
            </p>
          </div>
          
          <div class="info-card">
            <h3>🗺️ How to Use This Tool</h3>
            <ol>
              <li><strong>Get FIPS Codes:</strong> Use the reference below to find state and county codes</li>
              <li><strong>Enter Codes:</strong> Input the 2-digit state code and 3-digit county code</li>
              <li><strong>Optional Tract:</strong> Add a 6-digit tract code for specific tract data</li>
              <li><strong>Explore Data:</strong> View population, income, demographics, and more</li>
            </ol>
          </div>
          
          <div class="info-card">
            <h3>🔍 Common FIPS Codes</h3>
            <div class="fips-reference">
              <div class="fips-column">
                <h4>States</h4>
                <ul>
                  <li><strong>01:</strong> Alabama</li>
                  <li><strong>06:</strong> California</li>
                  <li><strong>12:</strong> Florida</li>
                  <li><strong>13:</strong> Georgia</li>
                  <li><strong>17:</strong> Illinois</li>
                  <li><strong>36:</strong> New York</li>
                  <li><strong>48:</strong> Texas</li>
                </ul>
              </div>
              <div class="fips-column">
                <h4>Example Counties</h4>
                <ul>
                  <li><strong>CA-037:</strong> Los Angeles County</li>
                  <li><strong>CA-075:</strong> San Francisco County</li>
                  <li><strong>NY-061:</strong> New York County (Manhattan)</li>
                  <li><strong>TX-201:</strong> Harris County (Houston)</li>
                  <li><strong>FL-086:</strong> Miami-Dade County</li>
                  <li><strong>IL-031:</strong> Cook County (Chicago)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div class="viewer-section">
          <app-census-tract-viewer></app-census-tract-viewer>
        </div>
      </div>

      <div class="page-footer">
        <div class="footer-info">
          <h4>Data Sources & Methodology</h4>
          <p>
            Data provided by the U.S. Census Bureau's American Community Survey (ACS) 5-Year Estimates. 
            This service uses the Census Data API to provide real-time access to demographic, social, 
            economic, and housing characteristics for census tracts nationwide.
          </p>
          <div class="footer-links">
            <a href="https://www.census.gov/data/developers/data-sets.html" target="_blank" rel="noopener">
              Census Data API Documentation
            </a>
            <a href="https://www.census.gov/programs-surveys/acs/" target="_blank" rel="noopener">
              American Community Survey
            </a>
            <a href="https://www.census.gov/geographies/reference-files/time-series/geo/county-files.html" target="_blank" rel="noopener">
              FIPS Code Lookup
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .census-page {
      min-height: 100vh;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      padding: 0;
    }

    .page-header {
      background: white;
      padding: 2rem 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }

    .breadcrumb {
      max-width: 1200px;
      margin: 0 auto 1rem auto;
      padding: 0 2rem;
      font-size: 14px;
      color: #666;
    }

    .breadcrumb a {
      color: #007bff;
      text-decoration: none;
    }

    .breadcrumb a:hover {
      text-decoration: underline;
    }

    .breadcrumb .separator {
      margin: 0 0.5rem;
      color: #999;
    }

    .breadcrumb .current {
      color: #333;
      font-weight: 500;
    }

    .page-header h1 {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
      font-size: 2.5rem;
      color: #333;
      font-weight: 700;
    }

    .page-description {
      max-width: 1200px;
      margin: 1rem auto 0 auto;
      padding: 0 2rem;
      font-size: 1.1rem;
      color: #666;
      line-height: 1.6;
    }

    .page-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 2rem;
      margin-bottom: 3rem;
    }

    .info-section {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .info-card {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      border-left: 4px solid #007bff;
    }

    .info-card h3 {
      margin: 0 0 1rem 0;
      color: #333;
      font-size: 1.2rem;
    }

    .info-card p {
      margin: 0 0 1rem 0;
      color: #666;
      line-height: 1.6;
    }

    .info-card ol {
      margin: 0;
      padding-left: 1.5rem;
      color: #666;
    }

    .info-card li {
      margin-bottom: 0.5rem;
      line-height: 1.5;
    }

    .fips-reference {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .fips-column h4 {
      margin: 0 0 0.5rem 0;
      color: #333;
      font-size: 1rem;
    }

    .fips-column ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .fips-column li {
      margin-bottom: 0.3rem;
      font-size: 0.9rem;
      color: #666;
    }

    .fips-column strong {
      color: #007bff;
      font-weight: 600;
    }

    .viewer-section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .page-footer {
      background: #333;
      color: white;
      padding: 2rem 0;
      margin-top: 3rem;
    }

    .footer-info {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
    }

    .footer-info h4 {
      margin: 0 0 1rem 0;
      color: #fff;
    }

    .footer-info p {
      margin: 0 0 1.5rem 0;
      color: #ccc;
      line-height: 1.6;
    }

    .footer-links {
      display: flex;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .footer-links a {
      color: #007bff;
      text-decoration: none;
      font-size: 0.9rem;
    }

    .footer-links a:hover {
      text-decoration: underline;
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .page-content {
        grid-template-columns: 1fr;
        gap: 1rem;
        padding: 0 1rem;
      }

      .page-header h1 {
        font-size: 2rem;
        padding: 0 1rem;
      }

      .page-description {
        padding: 0 1rem;
      }

      .breadcrumb {
        padding: 0 1rem;
      }

      .fips-reference {
        grid-template-columns: 1fr;
      }

      .footer-links {
        flex-direction: column;
        gap: 1rem;
      }

      .footer-info {
        padding: 0 1rem;
      }
    }

    @media (max-width: 480px) {
      .page-header {
        padding: 1rem 0;
      }

      .page-header h1 {
        font-size: 1.8rem;
      }

      .info-card {
        padding: 1rem;
      }

      .page-footer {
        padding: 1.5rem 0;
      }
    }
  `]
})
export class CensusPageComponent {
  constructor() {}
}
