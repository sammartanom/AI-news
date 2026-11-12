// Runs before first paint so the saved theme and layout do not flash. "auto" follows the system setting.
try {
  const t = JSON.parse(localStorage.getItem('signal:theme')); // written as JSON by js/state.js
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage unavailable: follow the system setting */ }
try {
  const page = location.pathname.split('/')[1] || 'home'; // matches the page keys in js/state.js
  const stored = JSON.parse(localStorage.getItem('signal:layout:' + page));
  if (stored === 'grid' || (stored === null && page === 'grid')) document.documentElement.dataset.layout = 'grid';
} catch { /* the grid page opens as cards, other lists as a list */ }
