'use client';

/**
 * Missions.
 *
 * Contracts are the game's directed play: an objective with a deadline and a reward,
 * issued by somebody who will remember whether you delivered.
 *
 * The board is entirely server-authored — which contracts exist, what they pay, whether
 * an objective is satisfied, and what unlocks next are all in the view. The only things
 * this screen decides are presentation and which facts to put side by side, because the
 * player's real question is "is this worth the days it will cost me?".
 */
import { useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { CommandButton } from '../../../../components/game/view-panel';
import { Badge, KeyValue, Meter, Panel, Progress, Stat, Tabs } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { days, humanise, money, num, pct } from '../../../../lib/format';
import type { MissionRow, MissionsView } from '../../../../lib/game-data';

type Tab = 'offers' | 'active' | 'history' | 'locked';

/** Difficulty and risk are 0…1 server numbers; the label is presentation only. */
function difficultyTone(difficulty: number): 'up' | 'info' | 'warn' | 'down' {
  if (difficulty <= 1.5) return 'up';
  if (difficulty <= 2.5) return 'info';
  if (difficulty <= 3.5) return 'warn';
  return 'down';
}

export default function MissionsPage() {
  const missions = useView<MissionsView>('missions');
  const data = missions.data;
  const [tab, setTab] = useState<Tab>('offers');

  const active = data?.active.length ?? 0;
  const offers = data?.offers.length ?? 0;
  const slots = data ? Math.max(0, data.maxActive - active) : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Empire</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Missions</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {data
              ? `${active} of ${data.maxActive} contract slots used · ${offers} on offer · ${data.completed} completed, ${data.failed} failed`
              : 'Reading the contract board…'}
          </p>
        </div>
        <Tabs
          label="Mission sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'offers', label: 'On offer', count: data?.offers.length },
            { id: 'active', label: 'In progress', count: data?.active.length },
            { id: 'history', label: 'History', count: data?.history.length },
            { id: 'locked', label: 'Locked', count: data?.locked.length },
          ]}
        />
      </header>

      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Contract slots" value={`${active} / ${data.maxActive}`} hint={slots === 0 ? 'finish one to take another' : `${slots} free`} tone={slots === 0 ? 'warn' : 'default'} />
          <Stat label="Completed" value={num(data.completed)} hint={`${num(data.failed)} failed or expired`} tone={data.completed > 0 ? 'up' : 'default'} />
          <Stat label="On offer" value={num(offers)} hint={offers === 0 ? 'the board refreshes with time' : 'accept one to start the clock'} />
          <Stat label="Next refresh" value={`Day ${num(data.nextRefreshDay)}`} hint="new contracts appear on the board" />
        </div>
      )}

      {tab === 'offers' && <List kind="offers" />}
      {tab === 'active' && <List kind="active" />}
      {tab === 'history' && <List kind="history" />}
      {tab === 'locked' && <Locked />}
    </div>
  );
}

const EMPTY: Record<Tab, { title: string; body: string }> = {
  offers: {
    title: 'No contracts on offer right now',
    body: 'The board turns over every few days and reflects who knows you and where you are standing. Advance time to bring new offers in, or travel somewhere with different interests.',
  },
  active: {
    title: 'Nothing accepted yet',
    body: 'An accepted contract puts its objectives and its deadline on the clock. Deliver before the deadline day and the payout, the experience and the reputation are yours.',
  },
  history: {
    title: 'No finished contracts',
    body: 'Completed, failed and expired work is listed here so you can see who you let down and what it cost.',
  },
  locked: {
    title: 'Nothing is locked',
    body: 'Every contract this world can currently generate is available to you.',
  },
};

function List({ kind }: { kind: 'offers' | 'active' | 'history' }) {
  const missions = useView<MissionsView>('missions');
  const data = missions.data;
  const rows = data ? data[kind] : [];

  return (
    <Panel
      title={kind === 'offers' ? 'Contracts on offer' : kind === 'active' ? 'Contracts in progress' : 'Contract history'}
      subtitle={
        kind === 'offers'
          ? 'Accepting costs you a slot, not money — spending the days is what the contract actually asks for'
          : kind === 'active'
            ? 'Objectives are tracked by the simulation as you trade, travel and produce'
            : 'Most recent first'
      }
    >
      {data === undefined && missions.error === null && <p className="text-xs text-ink-faint">Loading contracts…</p>}
      {missions.error && data === undefined && <InlineNote tone="down">Could not load the contract board: {missions.error.message}</InlineNote>}
      {data && rows.length === 0 && <EmptyState title={EMPTY[kind].title} body={EMPTY[kind].body} />}
      {rows.length > 0 && (
        <ul className="grid gap-2 xl:grid-cols-2">
          {rows.map((mission) => (
            <MissionCard key={mission.id} mission={mission} mode={kind} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MissionCard({ mission, mode }: { mission: MissionRow; mode: 'offers' | 'active' | 'history' }) {
  const finished = mission.status === 'completed' || mission.status === 'failed' || mission.status === 'expired';
  const overdue = !finished && mission.daysRemaining <= 0;

  return (
    <li className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{mission.title}</h3>
          <p className="text-[11px] text-ink-faint">
            {mission.giverName}
            {mission.giverFactionId ? ` · ${humanise(mission.giverFactionId)}` : ''} · {humanise(mission.kind)} · difficulty {num(mission.difficulty, 1)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={difficultyTone(mission.difficulty)}>{humanise(mission.status)}</Badge>
          {!finished && <Badge tone={overdue ? 'down' : mission.daysRemaining <= 1 ? 'warn' : 'neutral'}>{days(mission.daysRemaining)}</Badge>}
        </div>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{mission.description}</p>

      {mission.objectives.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {mission.objectives.map((objective) => (
            <div key={objective.id}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className={objective.completed ? 'text-up' : 'text-ink-dim'}>
                  {objective.completed ? '✔ ' : ''}
                  {objective.description}
                </span>
                <span className="tnum text-ink-faint">
                  {num(objective.current)} / {num(objective.required)}
                </span>
              </div>
              <Meter value={objective.progress} tone={objective.completed ? 'up' : 'gold'} height={4} label={objective.description} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
        <dl>
          <KeyValue label="Payment">{money(mission.rewardCash)}</KeyValue>
          <KeyValue label="Experience">{`${num(mission.rewardXp)} xp`}</KeyValue>
          <KeyValue label="Risk of things going wrong" tone={mission.risk > 0.3 ? 'text-warn' : undefined}>
            {pct(mission.risk, { from: 'fraction', decimals: 0 })}
          </KeyValue>
          {!finished && <KeyValue label="Deadline">{`day ${num(mission.deadlineDay)}`}</KeyValue>}
        </dl>
        <dl>
          {mission.reputationRewards.length > 0 && (
            <KeyValue label="Standing">
              {mission.reputationRewards.map((reward) => `${humanise(reward.dimension)} ${reward.amount > 0 ? '+' : ''}${num(reward.amount)}`).join(', ')}
            </KeyValue>
          )}
          {mission.unlocks.length > 0 && <KeyValue label="Unlocks">{mission.unlocks.map((unlock) => unlock.title).join(', ')}</KeyValue>}
          {mission.unlockReason && <KeyValue label="Locked by">{mission.unlockReason}</KeyValue>}
        </dl>
      </div>

      {mode !== 'history' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === 'offers' && (
            <CommandButton intent={{ type: 'mission.accept', missionId: mission.id }} label="Accept contract" size="sm" variant="primary" />
          )}
          {mode === 'active' && (
            <>
              <Progress value={mission.progress} tone="gold" label="Contract progress" />
              <CommandButton
                intent={{ type: 'mission.abandon', missionId: mission.id }}
                label="Abandon"
                size="sm"
                variant="danger"
                confirm={{
                  title: `Abandon “${mission.title}”?`,
                  body: 'The contract is dropped, the slot is freed and the giver will remember. Any standing you were promised is lost.',
                  confirmLabel: 'Abandon contract',
                  destructive: true,
                }}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Locked() {
  const missions = useView<MissionsView>('missions');
  const locked = missions.data?.locked ?? [];

  return (
    <Panel title="Locked contracts" subtitle="Work this world can generate for you once you qualify">
      {missions.data && locked.length === 0 && <EmptyState title={EMPTY.locked.title} body={EMPTY.locked.body} />}
      {locked.length > 0 && (
        <ul className="divide-y divide-line">
          {locked.map((entry) => (
            <li key={entry.defId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink">{entry.title}</span>
              <span className="text-xs text-ink-faint">{entry.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-ink-faint">
        Requirements come from the contract itself — level, reputation, a faction that trusts you, or equipment you do not own yet.
      </p>
    </Panel>
  );
}
