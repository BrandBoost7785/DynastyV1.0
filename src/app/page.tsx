import { registrySummary } from '../engine/registry';
import SystemStatus from './system-status';
import { CURRENT_SCHEMA_VERSION } from '../persistence/serialize';

export default function HomePage() {
  const summary = registrySummary();
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Dynasty Phase 1A</p>
        <h1>Server-authoritative API is live</h1>
        <p>
          The simulation engine is now behind an authenticated application layer: a typed API that creates games, runs authoritative
          commands with conflict-safe writes and idempotent retries, and serves read models the browser can render. The visual game
          interface is intentionally deferred to Phase 1B.
        </p>
        <dl>
          <div><dt>Schema</dt><dd>{CURRENT_SCHEMA_VERSION}</dd></div>
          <div><dt>Commodities</dt><dd>{summary.commodities}</dd></div>
          <div><dt>Locations</dt><dd>{summary.locations}</dd></div>
          <div><dt>Routes</dt><dd>{summary.routes}</dd></div>
          <div><dt>Events</dt><dd>{summary.events}</dd></div>
        </dl>
        <SystemStatus />
        <h2>What the client can call</h2>
        <table>
          <thead>
            <tr><th>Endpoint</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td><code>GET /api/auth/session</code></td><td>Who is signed in (200 for anonymous visitors).</td></tr>
            <tr><td><code>POST /api/games</code></td><td>Create a game owned by the session.</td></tr>
            <tr><td><code>GET /api/games/:id/state</code></td><td>The player-facing state projection.</td></tr>
            <tr><td><code>POST /api/games/:id/intent</code></td><td>Run one authoritative command.</td></tr>
            <tr><td><code>POST /api/games/:id/advance</code></td><td>Advance up to 30 days, returning the day report.</td></tr>
            <tr><td><code>GET /api/games/:id/views/:view</code></td><td>Every read model (market, finance, crypto, missions, …).</td></tr>
          </tbody>
        </table>
        <a href="/api/health">Open health check</a>
      </section>
    </main>
  );
}
