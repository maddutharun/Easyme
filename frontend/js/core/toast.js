export function showToast(message, type = 'info', action = null) {
  const container = document.querySelector('.toast-container') || (() => {
    const element = document.createElement('div');
    element.className = 'toast-container';
    document.body.appendChild(element);
    return element;
  })();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-message">${message}</div>`;
  if (action) toast.insertAdjacentHTML('beforeend', `<div class="toast-action">${action.label}</div>`);
  container.appendChild(toast);

  if (action) toast.querySelector('.toast-action').addEventListener('click', action.callback);
  setTimeout(() => toast.remove(), 3000);
}