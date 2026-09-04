/**
 * Socket.io Real-Time Integration
 * Live notifications, invoice updates, and collaborative features
 */

export class RealtimeService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Initialize Socket.io connection
  async connect() {
    try {
      // Load socket.io client from CDN
      if (!window.io) {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
        document.head.appendChild(script);

        await new Promise(resolve => {
          script.onload = resolve;
        });
      }

      this.socket = window.io(window.location.origin, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: this.maxReconnectAttempts
      });

      this.setupEventHandlers();
      return new Promise((resolve, reject) => {
        this.socket.once('connect', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('Socket.io connected');
          resolve();
        });

        this.socket.once('connect_error', reject);
      });
    } catch (error) {
      console.error('Socket.io connection failed:', error);
      throw error;
    }
  }

  // Setup event handlers
  setupEventHandlers() {
    this.socket.on('disconnect', () => {
      this.connected = false;
      console.log('Socket.io disconnected');
      this.showNotification('Offline', 'Connection lost. Attempting to reconnect...', 'warning');
    });

    this.socket.on('reconnect_attempt', () => {
      this.reconnectAttempts++;
      console.log('Reconnection attempt', this.reconnectAttempts);
    });

    this.socket.on('reconnect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('Socket.io reconnected');
      this.showNotification('Online', 'Connection restored', 'success');
    });

    // Listen for real-time events
    this.socket.on('invoice:uploaded', (data) => {
      this.emit('invoice:uploaded', data);
    });

    this.socket.on('invoice:approved', (data) => {
      this.emit('invoice:approved', data);
      this.showNotification('Approved', `${data.vendorName} invoice approved`, 'success');
    });

    this.socket.on('invoice:rejected', (data) => {
      this.emit('invoice:rejected', data);
      this.showNotification('Rejected', `${data.vendorName} invoice rejected`, 'warning');
    });

    this.socket.on('invoice:posted', (data) => {
      this.emit('invoice:posted', data);
      this.showNotification('Posted', `${data.vendorName} posted to ERP`, 'success');
    });

    this.socket.on('user:present', (data) => {
      this.emit('user:present', data);
      this.updatePresence(data);
    });

    this.socket.on('notification', (data) => {
      this.showNotification(data.title, data.message, data.type);
      this.emit('notification', data);
    });
  }

  // Emit event and notify listeners
  emit(eventName, data) {
    if (!this.listeners.has(eventName)) return;

    this.listeners.get(eventName).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    });
  }

  // Subscribe to events
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);

    return () => {
      const callbacks = this.listeners.get(eventName);
      const index = callbacks.indexOf(callback);
      if (index !== -1) callbacks.splice(index, 1);
    };
  }

  // Send event to server
  emit(eventName, data) {
    if (this.socket && this.connected) {
      this.socket.emit(eventName, data);
    }
  }

  // Notify user of real-time events
  showNotification(title, message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `realtime-notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <strong>${title}</strong>
        <p>${message}</p>
      </div>
      <button class="notification-close" aria-label="Close">×</button>
    `;

    const container = document.getElementById('realtimeNotifications') || 
                     document.body;
    
    if (!document.getElementById('realtimeNotifications')) {
      const notifContainer = document.createElement('div');
      notifContainer.id = 'realtimeNotifications';
      notifContainer.className = 'realtime-notifications';
      document.body.insertBefore(notifContainer, document.body.firstChild);
    }

    document.getElementById('realtimeNotifications').appendChild(notification);

    notification.querySelector('.notification-close').addEventListener('click', () => {
      notification.remove();
    });

    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  // Update online user presence
  updatePresence(users) {
    const presenceEl = document.getElementById('presenceIndicator');
    if (!presenceEl) return;

    presenceEl.innerHTML = `
      <div class="presence-header">
        <span class="presence-title">Active Users</span>
        <span class="presence-count">${users.length}</span>
      </div>
      <div class="presence-list">
        ${users.map(user => `
          <div class="presence-user">
            <span class="presence-dot"></span>
            <span>${user.name}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Broadcast typing indicator
  notifyTyping(invoiceId) {
    if (this.connected) {
      this.socket.emit('user:typing', { invoiceId });
    }
  }

  // Notify review started
  notifyReviewStart(invoiceId, userId) {
    if (this.connected) {
      this.socket.emit('invoice:review:start', { invoiceId, userId });
    }
  }

  // Notify review ended
  notifyReviewEnd(invoiceId, userId) {
    if (this.connected) {
      this.socket.emit('invoice:review:end', { invoiceId, userId });
    }
  }

  // Get connection status
  isConnected() {
    return this.connected;
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
}

export const realtimeService = new RealtimeService();
