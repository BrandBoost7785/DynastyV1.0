'use client';

/**
 * Combat.
 *
 * A live encounter is a turn-based tactical problem: who is standing, how badly hurt they
 * are, what cover they have, and which of the actions available to you is worth spending
 * this turn on.
 *
 * The client's job here is narrow on purpose. It renders the board the server sent, the
 * server's own hit-chance and expected-damage estimates, and the server's log. It never
 * rolls a die, never derives an odds figure and never decides an outcome — a turn is a
 * *choice* (`combat.take_turn` with a queued action list) that the simulation resolves.
 *
 * With no encounter in progress the screen is an honest report of that fact plus the
 * state that matters afterwards: injuries, bail and jail.
 */
import { useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, KeyValue, Meter, Panel, Stat, Table, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct, qty } from '../../../../lib/format';
import type { CombatAction, CombatOutcome, CombatParticipant, CombatView, GameStateDto } from '../../../../lib/game-data';

export default function CombatPage() {
  const combat = useView<CombatView | null>('combat');
  const { state, meta } = useGame();
  const locationName = state?.player.locationId ? humanise(state.player.locationId) : null;
  const prison = state?.player.prison ?? null;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Risk</p>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Combat</h1>
        <p className="mt-1 text-xs text-ink-dim">
          {combat.data
            ? `${humanise(combat.data.kind)} at ${combat.data.locationName} · turn ${combat.data.turn} of ${combat.data.turnLimit}`
            : 'No encounter in progress'}
        </p>
      </header>

      {combat.error && combat.data === undefined && <InlineNote tone="down">Could not read the encounter: {combat.error.message}</InlineNote>}

      {combat.data === null && <NoEncounter prison={prison} locationName={locationName} />}
      {combat.data && <Encounter combat={combat.data} />}

      {meta && (
        <p className="text-[11px] text-ink-faint">
          Every die roll, hit chance and outcome on this screen is computed by the simulation on the server. The browser only chooses actions.
        </p>
      )}
    </div>
  );
}

function NoEncounter({ prison, locationName }: { prison: GameStateDto['player']['prison'] | null; locationName: string | null }) {
  return (
    <div className="space-y-3">
      <Panel title="No active combat encounter." subtitle="Nothing is trying to kill you at this moment">
        <EmptyState
          icon={<span aria-hidden="true" className="text-2xl">⚔</span>}
          title="No active combat encounter."
          body={
            <>
              Encounters begin on their own: a shipment worth stealing, a checkpoint that decided you were worth searching, a
              faction that has run out of patience, or an enforcement raid on a property you own. When one starts, this screen
              becomes the tactical board — participants, cover, action points and the log — and it stays live until the fight is
              resolved, you flee, or somebody pays bail.
            </>
          }
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label="Encounter" value="None" hint={locationName ? `standing in ${locationName}` : 'current location'} />
          <Stat
            label="Custody"
            value={prison?.incarcerated ? prison.facility : 'Free'}
            hint={prison?.incarcerated ? `release day ${num(prison.releaseDay ?? 0)} · sentence ${num(prison.sentenceDays)} days` : 'no sentence outstanding'}
            tone={prison?.incarcerated ? 'warn' : 'default'}
          />
          <Stat
            label="Bail"
            value={prison?.incarcerated ? (prison.bailAmount === null ? 'Not offered' : prison.bailPaid ? 'Already paid' : money(prison.bailAmount)) : '—'}
            hint="set by the court, not by this screen"
            tone={prison?.incarcerated && prison.bailAmount !== null && !prison.bailPaid ? 'gold' : 'default'}
          />
        </div>
      </Panel>

      <Panel title="What you can still do" subtitle="Some commands remain available even when nothing is happening">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">While incarcerated</h3>
            <p className="text-xs text-ink-dim">
              {prison?.incarcerated
                ? `You are in ${prison.facility}${prison.releaseDay !== null ? `, released on day ${num(prison.releaseDay)}` : ''}. Bail is priced from your net worth and what you were caught doing; escaping is cheaper and much riskier. Both are decided by the server.`
                : 'Bail and escape only exist while you are in custody. Neither is offered when you are free.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <CommandButton
                intent={{ type: 'combat.pay_bail' }}
                label="Pay bail"
                size="sm"
                variant="primary"
                disabled={!prison?.incarcerated || prison.bailAmount === null || prison.bailPaid}
                disabledReason={
                  !prison?.incarcerated ? 'You are not in custody.' : prison.bailPaid ? 'Bail has already been posted.' : 'No bail was set for this sentence.'
                }
                confirm={{ title: 'Pay bail?', body: 'The amount is set by the court, not by this screen. Paying releases you immediately.', confirmLabel: 'Pay bail' }}
              />
              <CommandButton
                intent={{ type: 'combat.escape' }}
                label="Attempt escape"
                size="sm"
                variant="danger"
                disabled={!prison?.incarcerated}
                disabledReason="You are not in custody."
                confirm={{
                  title: 'Attempt to escape?',
                  body: 'A failed attempt costs time and adds to the sentence. This is a real attempt against the simulation, not a formality.',
                  confirmLabel: 'Try to escape',
                  destructive: true,
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Fresh in the log</h3>
            <p className="text-xs text-ink-dim">
              Encounters are also reported in the day report after they resolve, with the injuries, the loot or the fine that came
              out of them.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Encounter({ combat }: { combat: CombatView }) {
  const living = combat.participants.filter((participant) => participant.alive);
  const yours = combat.participants.filter((participant) => participant.side !== 'enemy');
  const active = combat.phase === 'active';
  const odds = combat.odds.victoryChance;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Encounter" value={humanise(combat.kind)} hint={combat.locationName} tone="warn" />
        <Stat label="Turn" value={`${num(combat.turn)} / ${num(combat.turnLimit)}`} hint={active ? 'the fight ends at the limit' : 'finished'} />
        <Stat label="Your side standing" value={`${num(yours.filter((p) => p.alive).length)} / ${num(living.length)}`} hint="yours alive / everyone alive" />
        <Stat
          label="Chance you win"
          value={pct(odds, { from: 'fraction', decimals: 0 })}
          hint={combat.autoResolved ? 'resolved automatically' : 'the simulation\'s estimate, not a promise'}
          tone={odds > 0.5 ? 'up' : 'down'}
        />
      </div>

      <p className="text-[11px] text-ink-faint">{combat.odds.explanation}</p>

      {combat.outcome && <Outcome outcome={combat.outcome} />}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Panel title="Field" subtitle="Position, cover and condition of everyone in the encounter">
            <Table label="Combat participants">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Side</Th>
                  <Th align="right">Health</Th>
                  <Th align="right">Actions</Th>
                  <Th align="right">Accuracy</Th>
                  <Th align="right">Damage per hit</Th>
                  <Th align="right">Defence</Th>
                  <Th align="right">Cover</Th>
                  <Th align="right">Position</Th>
                </tr>
              </thead>
              <tbody>
                {combat.participants.map((participant) => (
                  <ParticipantRow key={participant.id} participant={participant} />
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-[11px] text-ink-faint">
              The grid is {num(combat.grid.width)} × {num(combat.grid.height)} tiles. Distance costs accuracy; cover costs the enemy accuracy
              against whoever is behind it.
            </p>
          </Panel>

          {active ? <ActionQueue combat={combat} /> : <InlineNote tone="info">This encounter is resolved — the actions below are closed. Start moving again and the next encounter will open a fresh turn loop.</InlineNote>}

          <Panel title={`Log (last ${num(combat.log.length)} events)`} subtitle="Written by the simulation, newest last">
            {combat.log.length === 0 ? (
              <p className="text-xs text-ink-faint">No events have been logged yet.</p>
            ) : (
              <ol className="max-h-80 space-y-1 overflow-y-auto pr-1 text-xs">
                {combat.log.map((entry, index) => (
                  <li key={`${entry.turn}-${entry.actorId}-${index}`} className="flex gap-2">
                    <span className="tnum shrink-0 text-ink-faint">T{num(entry.turn)}</span>
                    <span className="min-w-0 flex-1 text-ink-dim">
                      <span className="text-ink">{entry.actorName}</span> {humanise(entry.action).toLowerCase()}
                      {entry.targetName ? ` ${entry.targetName}` : ''}
                      {entry.damage > 0 ? <span className="text-down"> · {num(entry.damage)} damage</span> : null}
                      {entry.critical ? <Badge tone="gold">critical</Badge> : null}
                      <span className="block text-[11px] text-ink-faint">{entry.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Stakes" subtitle="What this encounter is actually risking">
            <dl>
              <KeyValue label="Cash at risk">{combat.stakes.lossCash > 0 ? money(combat.stakes.lossCash) : 'none'}</KeyValue>
              <KeyValue label="Cargo at risk">{combat.stakes.lossInventoryFraction > 0 ? pct(combat.stakes.lossInventoryFraction, { from: 'fraction', decimals: 0 }) : 'none'}</KeyValue>
              <KeyValue label="Arrest chance if you lose">{pct(combat.stakes.arrestChance, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Injury chance">{pct(combat.stakes.injuryChance, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Death chance">{pct(combat.stakes.deathChance, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Experience on offer">{num(combat.stakes.xpReward)}</KeyValue>
              {combat.stakes.reputationReward.length > 0 && (
                <KeyValue label="Standing on offer">
                  {combat.stakes.reputationReward.map((reward) => `${humanise(reward.dimension)} ${reward.amount > 0 ? '+' : '−'}${num(Math.abs(reward.amount))}`).join(' · ')}
                </KeyValue>
              )}
              {combat.stakes.loot.length > 0 && (
                <KeyValue label="Loot on the table">
                  {combat.stakes.loot.map((item) => (item.commodityId ? humanise(item.commodityId) : money(item.cash ?? 0))).join(' · ')}
                </KeyValue>
              )}
              {combat.stakes.defendedPropertyId && <KeyValue label="Defending">{humanise(combat.stakes.defendedPropertyId)}</KeyValue>}
              {combat.stakes.defendedShipmentId && <KeyValue label="Defending shipment">{humanise(combat.stakes.defendedShipmentId)}</KeyValue>}
            </dl>
          </Panel>

          <Panel title="Way out" subtitle="Not every fight has to be finished">
            <dl>
              <KeyValue label="Can flee">{combat.canFlee ? 'yes' : 'no — you are cornered'}</KeyValue>
              <KeyValue label="Can negotiate">{combat.canNegotiate ? 'yes' : 'no'}</KeyValue>
              <KeyValue label="Can bribe">{combat.canBribe ? money(combat.bribeAmount) : 'no'}</KeyValue>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
              <CommandButton
                intent={{ type: 'combat.auto_resolve' }}
                label="Resolve automatically"
                size="sm"
                variant="secondary"
                disabled={!active}
                disabledReason="This encounter is already resolved."
                confirm={{
                  title: 'Let the simulation finish the fight?',
                  body: 'The server plays the remaining turns from here using the same rules it would use turn by turn. You keep the outcome, whatever it is.',
                  confirmLabel: 'Resolve it',
                }}
              />
              {combat.canBribe && (
                <CommandButton
                  intent={{ type: 'combat.take_turn', actions: [{ type: 'bribe', amount: combat.bribeAmount }] }}
                  label={`Bribe for ${money(combat.bribeAmount)}`}
                  size="sm"
                  variant="primary"
                  disabled={!active}
                  disabledReason="This encounter is already resolved."
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Outcome({ outcome }: { outcome: CombatOutcome }) {
  const tone = outcome.victory ? 'up' : outcome.fled || outcome.bribed || outcome.negotiated ? 'warn' : 'down';
  return (
    <Panel title="How it ended" subtitle={outcome.summary}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{outcome.victory ? 'victory' : outcome.arrested ? 'arrested' : outcome.fled ? 'fled' : outcome.bribed ? 'bribed out' : outcome.negotiated ? 'negotiated' : 'defeat'}</Badge>
        {outcome.xpGained > 0 && <Badge tone="gold">{num(outcome.xpGained)} XP</Badge>}
        {outcome.lootCash > 0 && <Badge tone="up">{money(outcome.lootCash)} taken</Badge>}
        {outcome.heatChange !== 0 && <Badge tone={outcome.heatChange > 0 ? 'down' : 'up'}>heat {outcome.heatChange > 0 ? '+' : '−'}{num(Math.abs(outcome.heatChange))}</Badge>}
      </div>
      {outcome.casualties.length > 0 && (
        <p className="mt-2 text-xs text-ink-dim">
          Casualties: {outcome.casualties.map((casualty) => `${casualty.name} (${casualty.status})`).join(', ')}
        </p>
      )}
      {outcome.lootItems.length > 0 && (
        <p className="mt-1 text-xs text-ink-dim">
          Recovered: {outcome.lootItems.map((item) => `${qty(item.qty)} ${humanise(item.commodityId).toLowerCase()}`).join(', ')}
        </p>
      )}
      {outcome.reputationChanges.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {outcome.reputationChanges.map((change, index) => (
            <li key={`${change.dimension}-${index}`} className="text-xs text-ink-dim">
              {humanise(change.dimension)} {change.amount > 0 ? '+' : '−'}{num(Math.abs(change.amount))} — {change.reason}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ParticipantRow({ participant }: { participant: CombatParticipant }) {
  return (
    <Tr className={participant.alive ? '' : 'opacity-60'}>
      <Td>
        <span className="text-sm text-ink">{participant.name}</span>
        {participant.tier !== undefined && (
          <span className="block text-[11px] text-ink-faint">
            {humanise(participant.tier)}
            {participant.description ? ` · ${participant.description}` : ''}
          </span>
        )}
      </Td>
      <Td>
        <Badge tone={participant.side === 'enemy' ? 'down' : 'up'}>{participant.side === 'enemy' ? 'against you' : participant.side === 'ally' ? 'ally' : 'you'}</Badge>
        {!participant.alive && (
          <span className="ml-1.5">
            <Badge tone="neutral">out of the fight</Badge>
          </span>
        )}
      </Td>
      <Td align="right">
        <Meter
          value={participant.hpPct}
          tone={participant.hpPct < 0.3 ? 'down' : participant.hpPct < 0.6 ? 'warn' : 'up'}
          display={`${num(participant.hp)} / ${num(participant.maxHp)}`}
          label={`${participant.name} health`}
        />
      </Td>
      <Td align="right" className="tnum text-xs">{`${num(participant.ap)} / ${num(participant.maxAp)}`}</Td>
      <Td align="right" className="tnum text-xs">{pct(participant.accuracy, { from: 'fraction', decimals: 0 })}</Td>
      <Td align="right" className="tnum text-xs">{`${num(participant.damage[0])}–${num(participant.damage[1])}`}</Td>
      <Td align="right" className="tnum text-xs">{pct(participant.defense, { from: 'fraction', decimals: 0 })}</Td>
      <Td align="right" className="text-xs">{participant.cover ? 'in cover' : 'exposed'}</Td>
      <Td align="right" className="tnum text-xs text-ink-faint">{`${num(participant.position.x)}, ${num(participant.position.y)}`}</Td>
    </Tr>
  );
}

/**
 * Queue up to eight actions, then send them as one turn.
 *
 * Eight is the server's own maximum for a turn, so the control stops there rather than
 * letting the player build a list the API will reject. Every option offered here is an
 * estimate the server published — the client invents no targets, coordinates or odds.
 */
function ActionQueue({ combat }: { combat: CombatView }) {
  const [actions, setActions] = useState<CombatAction[]>([]);

  const push = (action: CombatAction) => setActions((current) => (current.length >= 8 ? current : [...current, action]));

  return (
    <Panel
      title="This turn"
      subtitle={`${num(actions.length)} of 8 actions queued — they resolve in order when you commit`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => setActions([])} disabled={actions.length === 0}>
          Clear
        </Button>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Available to you</h3>
          {combat.estimates.length === 0 ? (
            <p className="text-xs text-ink-faint">The server has published no actions for this encounter state — you may be out of action points for this turn.</p>
          ) : (
            <ul className="space-y-1.5">
              {combat.estimates.map((estimate, index) => (
                <li key={`${estimate.action.type}-${index}`} className="rounded border border-line bg-panel px-2.5 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-ink">{estimate.label}</span>
                    <span className="tnum text-xs text-ink-dim">
                      {estimate.apCost > 0 ? `${num(estimate.apCost)} AP · ` : ''}
                      {pct(estimate.successChance, { from: 'fraction', decimals: 0 })} chance
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-faint">{estimate.expectedValue}</p>
                  <div className="mt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => push(estimate.action)}
                      disabled={!estimate.available || actions.length >= 8}
                      {...(!estimate.available ? { title: estimate.reason ?? 'Not available' } : {})}
                    >
                      Add to turn
                    </Button>
                    {!estimate.available && estimate.reason && <span className="ml-2 text-[11px] text-warn">{estimate.reason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Queued</h3>
          {actions.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing queued. Add actions, then commit the turn.</p>
          ) : (
            <ol className="space-y-1">
              {actions.map((action, index) => (
                <li key={`${action.type}-${index}`} className="flex items-center justify-between gap-2 rounded border border-line bg-panel px-2 py-1 text-xs">
                  <span className="text-ink-dim">{describeAction(action, combat)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActions((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Remove ${describeAction(action, combat)}`}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <CommandButton
            intent={{ type: 'combat.take_turn', actions }}
            label="Commit turn"
            variant="primary"
            disabled={actions.length === 0}
            disabledReason="Queue at least one action."
            onDone={(outcome) => {
              if (outcome.ok) setActions([]);
            }}
          />
          <p className="text-[11px] text-ink-faint">
            The turn resolves server-side in the order queued. Movement, cover, accuracy and damage are all decided by the simulation
            — if a queued action becomes impossible, the server says so instead of guessing on your behalf.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function describeAction(action: CombatAction, combat: CombatView): string {
  switch (action.type) {
    case 'attack':
      return `Attack ${combat.participants.find((participant) => participant.id === action.targetId)?.name ?? 'target'}`;
    case 'move':
      return `Move to ${num(action.x)}, ${num(action.y)}`;
    case 'useItem':
      return `Use ${humanise(action.commodityId).toLowerCase()}`;
    case 'bribe':
      return `Bribe for ${money(action.amount)}`;
    default:
      return humanise(action.type);
  }
}
