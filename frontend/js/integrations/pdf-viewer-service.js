/**
 * PDF.js Inline Viewer Integration
 * Embed PDFs with annotations, zoom, and rotation
 */

export class PdfViewerService {
  constructor() {
    this.pdfs = new Map();
    this.currentPage = 0;
    this.zoomLevel = 1;
  }

  // Load PDF.js library
  static async loadPdfJs() {
    if (window.pdfjsLib) return;

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    document.head.appendChild(script);

    return new Promise(resolve => {
      script.onload = () => {
        // Set worker
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
    });
  }

  // Create PDF viewer container
  renderPdfViewer(containerId, pdfUrl) {
    return `
      <div class="pdf-viewer" id="${containerId}">
        <div class="pdf-toolbar">
          <button class="pdf-btn pdf-prev" title="Previous page">← Prev</button>
          <span class="pdf-page-info">Page <span id="${containerId}-page">1</span></span>
          <button class="pdf-btn pdf-next" title="Next page">Next →</button>
          
          <div class="pdf-separator"></div>
          
          <button class="pdf-btn pdf-zoom-out" title="Zoom out">−</button>
          <span class="pdf-zoom-level"><span id="${containerId}-zoom">100</span>%</span>
          <button class="pdf-btn pdf-zoom-in" title="Zoom in">+</button>
          
          <div class="pdf-separator"></div>
          
          <button class="pdf-btn pdf-rotate" title="Rotate">↻</button>
          <button class="pdf-btn pdf-download" title="Download" onclick="window.open('${pdfUrl}', '_blank')">⬇</button>
        </div>
        
        <div class="pdf-canvas-wrapper">
          <canvas id="${containerId}-canvas" class="pdf-canvas"></canvas>
        </div>
      </div>
    `;
  }

  // Load and render PDF
  async loadPdf(pdfUrl, containerId) {
    await PdfViewerService.loadPdfJs();

    try {
      const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
      this.pdfs.set(containerId, {
        pdf,
        currentPage: 1,
        totalPages: pdf.numPages,
        rotation: 0
      });

      await this.renderPage(containerId, 1);
      this.setupControls(containerId);
    } catch (error) {
      console.error('PDF load error:', error);
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '<div class="pdf-error">Failed to load PDF. Please try again.</div>';
      }
    }
  }

  // Render specific page
  async renderPage(containerId, pageNum) {
    const pdfData = this.pdfs.get(containerId);
    if (!pdfData) return;

    const { pdf, rotation } = pdfData;
    const page = await pdf.getPage(pageNum);
    const canvas = document.getElementById(`${containerId}-canvas`);
    const ctx = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: this.zoomLevel, rotation });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    pdfData.currentPage = pageNum;
    document.getElementById(`${containerId}-page`).textContent = pageNum;
    document.getElementById(`${containerId}-zoom`).textContent = Math.round(this.zoomLevel * 100);
  }

  // Setup viewer controls
  setupControls(containerId) {
    const container = document.getElementById(containerId);
    const pdfData = this.pdfs.get(containerId);

    // Previous button
    container.querySelector('.pdf-prev')?.addEventListener('click', async () => {
      if (pdfData.currentPage > 1) {
        await this.renderPage(containerId, pdfData.currentPage - 1);
      }
    });

    // Next button
    container.querySelector('.pdf-next')?.addEventListener('click', async () => {
      if (pdfData.currentPage < pdfData.totalPages) {
        await this.renderPage(containerId, pdfData.currentPage + 1);
      }
    });

    // Zoom in
    container.querySelector('.pdf-zoom-in')?.addEventListener('click', async () => {
      this.zoomLevel *= 1.2;
      await this.renderPage(containerId, pdfData.currentPage);
    });

    // Zoom out
    container.querySelector('.pdf-zoom-out')?.addEventListener('click', async () => {
      this.zoomLevel = Math.max(0.5, this.zoomLevel / 1.2);
      await this.renderPage(containerId, pdfData.currentPage);
    });

    // Rotate
    container.querySelector('.pdf-rotate')?.addEventListener('click', async () => {
      pdfData.rotation = (pdfData.rotation + 90) % 360;
      await this.renderPage(containerId, pdfData.currentPage);
    });
  }

  // Annotate PDF (highlight key fields)
  async annotateField(containerId, fieldName, coordinates) {
    const canvas = document.getElementById(`${containerId}-canvas`);
    const ctx = canvas.getContext('2d');

    // Draw yellow highlight box
    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
    ctx.fillRect(coordinates.x, coordinates.y, coordinates.width, coordinates.height);
    ctx.strokeStyle = 'rgba(255, 200, 0, 1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(coordinates.x, coordinates.y, coordinates.width, coordinates.height);

    // Draw label
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText(fieldName, coordinates.x, coordinates.y - 5);
  }

  // Compare two PDFs side by side
  renderPdfComparison(container1Id, container2Id, pdf1Url, pdf2Url) {
    const wrapper = document.getElementById(container1Id)?.parentElement;
    if (!wrapper) return;

    wrapper.style.display = 'grid';
    wrapper.style.gridTemplateColumns = '1fr 1fr';
    wrapper.style.gap = '20px';

    this.loadPdf(pdf1Url, container1Id);
    this.loadPdf(pdf2Url, container2Id);
  }
}

export const pdfViewerService = new PdfViewerService();
