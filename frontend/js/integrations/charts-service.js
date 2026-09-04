/**
 * Recharts Dashboard Integration
 * Creates interactive charts for invoice analytics
 */

export class ChartsService {
  constructor() {
    this.charts = [];
  }

  // Load Recharts from CDN
  static async loadRecharts() {
    if (window.Recharts) return;
    
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/react@18/umd/react.production.min.js';
    document.head.appendChild(script);
    
    await new Promise(resolve => {
      script.onload = resolve;
    });

    const script2 = document.createElement('script');
    script2.src = 'https://unpkg.com/recharts@2.10.0/dist/Recharts.js';
    document.head.appendChild(script2);
    
    return new Promise(resolve => {
      script2.onload = resolve;
    });
  }

  // Create a simple chart container
  createChartContainer(id, title, type = 'bar') {
    return `
      <div class="chart-container">
        <div class="chart-header">
          <h3>${title}</h3>
          <button class="chart-menu" aria-label="Chart options">⋮</button>
        </div>
        <div id="${id}" class="chart-wrapper" style="width: 100%; height: 300px; position: relative;">
          <canvas id="${id}-canvas"></canvas>
        </div>
      </div>
    `;
  }

  // Create vendor spend chart using Chart.js (fallback since Recharts needs React)
  createVendorSpendChart(invoices) {
    const vendorMap = {};
    invoices.forEach(inv => {
      if (inv.vendorName) {
        vendorMap[inv.vendorName] = (vendorMap[inv.vendorName] || 0) + (parseFloat(inv.amount) || 0);
      }
    });

    const labels = Object.keys(vendorMap).slice(0, 10);
    const data = labels.map(v => vendorMap[v]);

    return {
      type: 'bar',
      labels,
      datasets: [{
        label: 'Vendor Spend',
        data,
        backgroundColor: 'rgba(52, 152, 219, 0.7)',
        borderColor: 'rgba(52, 152, 219, 1)',
        borderWidth: 2
      }]
    };
  }

  // Create invoice pipeline chart
  createPipelineChart(invoices) {
    const statuses = { pending: 0, approved: 0, rejected: 0, posted: 0 };
    invoices.forEach(inv => {
      const status = inv.status || 'pending';
      statuses[status] = (statuses[status] || 0) + 1;
    });

    return {
      type: 'doughnut',
      labels: Object.keys(statuses),
      datasets: [{
        label: 'Invoice Status',
        data: Object.values(statuses),
        backgroundColor: [
          'rgba(230, 126, 34, 0.7)',
          'rgba(46, 204, 113, 0.7)',
          'rgba(231, 76, 60, 0.7)',
          'rgba(52, 152, 219, 0.7)'
        ],
        borderColor: [
          'rgba(230, 126, 34, 1)',
          'rgba(46, 204, 113, 1)',
          'rgba(231, 76, 60, 1)',
          'rgba(52, 152, 219, 1)'
        ],
        borderWidth: 2
      }]
    };
  }

  // Create amount distribution chart
  createAmountDistributionChart(invoices) {
    const ranges = {
      '0-10K': 0,
      '10K-50K': 0,
      '50K-100K': 0,
      '100K+': 0
    };

    invoices.forEach(inv => {
      const amount = parseFloat(inv.amount) || 0;
      if (amount < 10000) ranges['0-10K']++;
      else if (amount < 50000) ranges['10K-50K']++;
      else if (amount < 100000) ranges['50K-100K']++;
      else ranges['100K+']++;
    });

    return {
      type: 'line',
      labels: Object.keys(ranges),
      datasets: [{
        label: 'Invoice Distribution',
        data: Object.values(ranges),
        borderColor: 'rgba(52, 152, 219, 1)',
        backgroundColor: 'rgba(52, 152, 219, 0.1)',
        borderWidth: 2,
        tension: 0.4
      }]
    };
  }

  // Render SVG chart (lightweight alternative)
  renderSvgBarChart(containerId, data, label) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const maxValue = Math.max(...data);
    const chartHeight = 300;
    const chartWidth = container.clientWidth || 600;
    const barWidth = chartWidth / data.length;

    let svg = `<svg width="${chartWidth}" height="${chartHeight}" style="background: transparent;">`;
    
    // Draw bars
    data.forEach((value, index) => {
      const barHeight = (value / maxValue) * (chartHeight - 60);
      const x = index * barWidth + 10;
      const y = chartHeight - barHeight - 30;

      svg += `
        <rect x="${x}" y="${y}" width="${barWidth - 20}" height="${barHeight}" 
              fill="rgba(52, 152, 219, 0.7)" stroke="rgba(52, 152, 219, 1)" stroke-width="2" />
        <text x="${x + (barWidth - 20) / 2}" y="${chartHeight - 10}" text-anchor="middle" font-size="12">
          ${value}
        </text>
      `;
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }
}

export const chartsService = new ChartsService();
