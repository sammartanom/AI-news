import { route } from '../router.mjs';
import { json } from '../lib/http.mjs';
import { accountsEnabled, logoutUrl } from '../auth/session.mjs';

const view = (u) => (u ? { id: u.id, email: u.email, display_name: u.display_name ?? null, role: u.role } : null);

route('GET', '/api/me', (c) => json({ user: view(c.user), accounts_enabled: accountsEnabled(c.env), logout_url: logoutUrl(c.env) }));

// Editor sign-in. Visitors have no accounts: their saves are encrypted in the browser (routes/vault.mjs).
// Protect /login with an Access application; once Access has authenticated
// the visitor, this sends them back to the page they came from.
route('GET', '/login', (c) => {
  if (!c.user) {
    return new Response(accountsEnabled(c.env) ? 'Sign-in required. Cloudflare Access should have prompted you.' : 'Accounts are not enabled on this deployment.', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const next = c.url.searchParams.get('next') || '/';
  const target = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
});
