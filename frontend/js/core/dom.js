export function renderBreadcrumb(items) {
  return items.map((item, index) => {
    const prefix = index > 0 ? '<span class="breadcrumb-separator">›</span>' : '';
    if (item.link) return `<span>${prefix}<a data-route="${item.link}">${item.label}</a></span>`;
    return `<span>${prefix}<span class="breadcrumb-current">${item.label}</span></span>`;
  }).join('');
}

