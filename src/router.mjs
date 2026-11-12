const table = [];

export function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  table.push({ method, re, keys, handler });
}

export function match(method, path) {
  let pathMatched = false;
  for (const r of table) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { handler: r.handler, params };
  }
  return { handler: null, params: null, pathMatched };
}
