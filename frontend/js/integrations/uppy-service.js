/**
 * Uppy File Upload Integration
 * Advanced file upload with progress, validation, and preview
 */

export class UppyUploadService {
  constructor() {
    this.uploads = new Map();
    this.uploadId = 0;
  }

  // Initialize Uppy from node_modules
  static async initUppy() {
    if (window.Uppy) return window.Uppy;

    // Uppy is bundled in node_modules, we create a wrapper for vanilla JS usage
    return {
      addFile: async (file) => {
        return await this.handleFileUpload(file);
      }
    };
  }

  // Create upload UI component
  renderUploadUI() {
    return `
      <div class="uppy-upload-zone" id="uppyZone">
        <div class="uppy-icon">📁</div>
        <h2>Drag invoices here or click to browse</h2>
        <p class="uppy-hint">Supports PDF, PNG, JPG, Excel files</p>
        <input type="file" id="uppyInput" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls" style="display: none;" />
        <button class="uppy-browse-btn" onclick="document.getElementById('uppyInput').click()">
          Browse Files
        </button>
        <div id="uppyProgress" class="uppy-progress"></div>
      </div>
    `;
  }

  // Setup drag-and-drop
  setupDragDrop(zoneSelector) {
    const zone = document.querySelector(zoneSelector);
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('uppy-active');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('uppy-active');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('uppy-active');
      
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await this.uploadFile(file);
      }
    });

    // Handle file input change
    const input = document.getElementById('uppyInput');
    if (input) {
      input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          await this.uploadFile(file);
        }
      });
    }
  }

  // Upload single file with progress
  async uploadFile(file) {
    const uploadId = ++this.uploadId;
    const formData = new FormData();
    formData.append('file', file);

    const progressBar = document.createElement('div');
    progressBar.className = 'uppy-file-progress';
    progressBar.innerHTML = `
      <div class="uppy-file-name">${file.name}</div>
      <div class="uppy-progress-bar">
        <div class="uppy-progress-fill" style="width: 0%"></div>
      </div>
      <div class="uppy-progress-text">0%</div>
    `;

    const progressContainer = document.getElementById('uppyProgress');
    if (progressContainer) {
      progressContainer.appendChild(progressBar);
    }

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          const fill = progressBar.querySelector('.uppy-progress-fill');
          const text = progressBar.querySelector('.uppy-progress-text');
          
          if (fill) fill.style.width = percent + '%';
          if (text) text.textContent = Math.round(percent) + '%';
        }
      });

      return new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            progressBar.classList.add('uppy-success');
            progressBar.querySelector('.uppy-progress-text').textContent = '✓ Done';
            this.uploads.set(uploadId, JSON.parse(xhr.responseText));
            resolve(this.uploads.get(uploadId));
          } else {
            progressBar.classList.add('uppy-error');
            progressBar.querySelector('.uppy-progress-text').textContent = '✗ Failed';
            reject(new Error('Upload failed'));
          }
        };

        xhr.onerror = () => {
          progressBar.classList.add('uppy-error');
          reject(new Error('Network error'));
        };

        xhr.open('POST', '/api/invoices/upload');
        xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
        xhr.send(formData);
      });
    } catch (error) {
      progressBar.classList.add('uppy-error');
      console.error('Upload error:', error);
      throw error;
    }
  }

  // Batch upload multiple files
  async uploadMultiple(files) {
    const results = [];
    for (const file of files) {
      try {
        const result = await this.uploadFile(file);
        results.push(result);
      } catch (error) {
        console.error('Failed to upload:', file.name, error);
      }
    }
    return results;
  }

  // Get upload status
  getUploadStatus(uploadId) {
    return this.uploads.get(uploadId);
  }

  // Clear all uploads
  clearUploads() {
    this.uploads.clear();
    const progressContainer = document.getElementById('uppyProgress');
    if (progressContainer) progressContainer.innerHTML = '';
  }
}

export const uppyService = new UppyUploadService();
