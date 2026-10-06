#!/usr/bin/env tsx
/**
 * Lightweight local economy inspection.
 *
 * This is intentionally read-only: it builds the registries and a deterministic
 * fresh game, then prints high-level counts and starter-market facts useful when
 * checking balance changes. It does not require database credentials.
 */
import { registrySummary, getCommodityRegistry } from '../src/engine/registry';
import { createNewGame } from '../src/sim/bootstrap';
import { marketRows, playerArbitrage } from '../src/sim/markets';
import { validateState } from '../src/sim/state';

const seed = process.argv[2] ?? 'inspect-economy';
const { state } = createNewGame({ userId: 'inspect', playerName: 'Inspector', seed });
const rows = marketRows(state, state.player.locationId, { onlyTradable: true });
const registry = getCommodityRegistry();

const cheapest = [...rows]
  .filter((r) => r.ask > 0)
  .sort((a, b) => a.ask - b.ask)
  .slice(0, 8)
  .map((r) => ({ id: r.commodityId, name: registry.get(r.commodityId)?.name ?? r.commodityId, ask: r.ask, bid: r.bid }));

console.log(JSON.stringify({
  seed,
  summary: registrySummary(),
  startLocation: state.player.locationId,
  invariantErrors: validateState(state).filter((i) => i.severity === 'error').length,
  marketRows: rows.length,
  cheapest,
  arbitrageOpportunities: playerArbitrage(state).length,
}, null, 2));
