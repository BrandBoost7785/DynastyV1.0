'use client';

/**
 * Progression.
 *
 * Who the player is becoming: level and title, the skills that change how every other
 * screen resolves, the perks already banked, the standing the world grants, and the
 * achievements that record what has actually been done.
 *
 * The catalogue is the interesting part. Skills and perks arrive with the server's own
 * verdict — `canLearn`, `canTake` and a `reason` when the answer is no — so this screen
 * never re-implements a prerequisite rule to grey out a button. The one command it adds
 * that could be abused is prestige, so it is confirmed and shows the thresholds the
 * server will actually check.
 */
import { useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, Input, KeyValue, Meter, Panel, Progress, Select, Stat, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { ProgressionView } from '../../../../lib/game-data';

type Tab = 'skills' | 'perks' | 'achievements' | 'standing' | 'prestige';

export default function ProgressionPage() {
  const progression = useView<ProgressionView>('progression');
  const data = progression.data;
  const [tab, setTab] = useState<Tab>('skills');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Progress</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Progression</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {data
              ? `Level ${num(data.level)} · ${data.title} · ${num(data.skillPoints)} skill point${data.skillPoints === 1 ? '' : 's'} and ${num(data.perkPoints)} perk point${data.perkPoints === 1 ? '' : 's'} unspent`
              : 'Reading your record…'}
          </p>
        </div>
        <Tabs
          label="Progression sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'skills', label: 'Skills', count: data?.skillCatalogue.length },
            { id: 'perks', label: 'Perks', count: data?.perkCatalogue.length },
            { id: 'achievements', label: 'Achievements', count: data?.achievementsTotal },
            { id: 'standing', label: 'Standing' },
            { id: 'prestige', label: 'Prestige' },
          ]}
        />
      </header>

      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Level" value={num(data.level)} hint={data.title} tone="gold" />
          <Stat
            label="Experience"
            value={`${num(data.xp)} / ${num(data.xpToNext)}`}
            hint={`${pct(data.xpProgress, { from: 'fraction', decimals: 0 })} to the next level`}
          />
          <Stat label="Unspent points" value={`${num(data.skillPoints)} / ${num(data.perkPoints)}`} hint="skill points / perk points" tone={data.skillPoints > 0 || data.perkPoints > 0 ? 'up' : 'default'} />
          <Stat label="Achievements" value={`${num(data.achievementsEarned)} / ${num(data.achievementsTotal)}`} hint={data.prestigeCount > 0 ? `${num(data.prestigeCount)} prestige run${data.prestigeCount === 1 ? '' : 's'}` : 'no prestige yet'} />
        </div>
      )}

      {data && data.skillPoints > 0 && tab !== 'skills' && (
        <InlineNote tone="warn">
          You have {num(data.skillPoints)} unspent skill point{data.skillPoints === 1 ? '' : 's'} — every one of them changes how trading, travel, crew or crime resolves.
        </InlineNote>
      )}

      {tab === 'skills' && <Skills />}
      {tab === 'perks' && <Perks />}
      {tab === 'achievements' && <Achievements />}
      {tab === 'standing' && <Standing />}
      {tab === 'prestige' && <Prestige />}
    </div>
  );
}

function Skills() {
  const progression = useView<ProgressionView>('progression');
  const data = progression.data;
  const [tree, setTree] = useState('');
  const [hideMaxed, setHideMaxed] = useState(false);

  const catalogue = data?.skillCatalogue ?? [];
  const trees = [...new Set(catalogue.map((skill) => skill.tree))];
  const visible = catalogue
    .filter((skill) => (!tree || skill.tree === tree) && (!hideMaxed || skill.level < skill.maxLevel))
    .sort((a, b) => (b.canLearn ? 1 : 0) - (a.canLearn ? 1 : 0) || a.tree.localeCompare(b.tree) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-3">
      <Panel title="Learned" subtitle="What is already changing your numbers">
        {data && data.skills.length === 0 ? (
          <EmptyState title="No skills learned yet" body="Skills are bought with the points levels give you. Each level of a skill compounds into the systems it governs — spreads, freight, discretion, hacking." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(data?.skills ?? []).map((skill) => (
              <li key={skill.id} className="rounded-panel border border-line bg-panel px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">{skill.name}</span>
                  <span className="tnum text-xs text-ink-faint">
                    {skill.level} / {skill.maxLevel}
                  </span>
                </div>
                <Meter value={skill.level / Math.max(1, skill.maxLevel)} tone="gold" label={`${skill.name} level`} />
                <p className="mt-1 text-[11px] text-ink-dim">{skill.effect}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Catalogue"
        subtitle="Every skill the world offers, with the server's verdict on whether you can learn it now"
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <span>Tree</span>
              <Select aria-label="Filter by skill tree" value={tree} onChange={(event) => setTree(event.target.value)}>
                <option value="">All trees</option>
                {trees.map((name) => (
                  <option key={name} value={name}>
                    {humanise(name)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <input type="checkbox" checked={hideMaxed} onChange={(event) => setHideMaxed(event.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
              <span>Hide maxed</span>
            </label>
          </>
        }
      >
        {catalogue.length === 0 && <EmptyState title="No skills in this world" body="The skill catalogue is empty — nothing to learn." />}
        {catalogue.length > 0 && visible.length === 0 && <EmptyState title="Nothing matches those filters" body="Clear the tree filter or show maxed skills." />}
        {visible.length > 0 && (
          <ul className="grid gap-2 xl:grid-cols-2">
            {visible.map((skill) => (
              <li key={skill.id} className="rounded-panel border border-line bg-panel px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-ink">{skill.name}</h3>
                    <p className="text-[11px] text-ink-faint">
                      {humanise(skill.tree)} · level {skill.level} / {skill.maxLevel}
                    </p>
                  </div>
                  {skill.level >= skill.maxLevel ? <Badge tone="gold">maxed</Badge> : <Badge tone={skill.canLearn ? 'up' : 'neutral'}>{skill.canLearn ? 'learnable' : 'locked'}</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-dim">{skill.description}</p>
                {skill.effectPerLevel && <p className="mt-1 text-[11px] text-ink-faint">Per level: {skill.effectPerLevel}</p>}
                {skill.prerequisites.length > 0 && (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    Requires {skill.prerequisites.map((pre) => `${humanise(pre.skillId)} ${pre.level}`).join(', ')}
                  </p>
                )}
                <div className="mt-2">
                  <CommandButton
                    intent={{ type: 'progression.learn_skill', skillId: skill.id }}
                    label={skill.level === 0 ? 'Learn' : 'Raise a level'}
                    size="sm"
                    variant="primary"
                    disabled={!skill.canLearn}
                    disabledReason={skill.reason ?? (skill.level >= skill.maxLevel ? 'This skill is already at its maximum.' : 'Not available yet.')}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Perks() {
  const progression = useView<ProgressionView>('progression');
  const data = progression.data;
  const catalogue = data?.perkCatalogue ?? [];

  return (
    <div className="space-y-3">
      <Panel title="Held perks" subtitle="One-off talents that bend a rule rather than improve a number">
        {data && data.perks.length === 0 ? (
          <EmptyState title="No perks taken" body="Perks cost perk points, which levels grant rarely. They are the build-defining choices: a perk changes a rule outright instead of nudging a percentage." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {(data?.perks ?? []).map((perk) => (
              <li key={perk.id} className="rounded-panel border border-line bg-panel px-3 py-2">
                <h3 className="text-sm font-medium text-ink">{perk.name}</h3>
                <p className="mt-1 text-xs text-ink-dim">{perk.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(perk.modifiers).map(([key, value]) => (
                    <li key={key}>
                      <Badge tone="violet">
                        {humanise(key)} {value > 0 ? '+' : ''}
                        {num(value, 2)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Perk catalogue" subtitle="Requirements are checked by the server, including the reason when they are not met">
        {catalogue.length === 0 && <EmptyState title="No perks in this world" body="The perk catalogue is empty." />}
        {catalogue.length > 0 && (
          <ul className="grid gap-2 xl:grid-cols-2">
            {catalogue.map((perk) => (
              <li key={perk.id} className="rounded-panel border border-line bg-panel px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-ink">{perk.name}</h3>
                    <p className="text-[11px] text-ink-faint">{humanise(perk.tree)}</p>
                  </div>
                  {perk.taken ? <Badge tone="gold">taken</Badge> : <Badge tone={perk.canTake ? 'up' : 'neutral'}>{perk.canTake ? 'available' : 'locked'}</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-dim">{perk.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(perk.modifiers).map(([key, value]) => (
                    <li key={key}>
                      <Badge tone="info">
                        {humanise(key)} {value > 0 ? '+' : ''}
                        {num(value, 2)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                {perk.requiresSkillId && (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    Requires {humanise(perk.requiresSkillId)} {perk.requiresSkillLevel}
                  </p>
                )}
                <div className="mt-2">
                  <CommandButton
                    intent={{ type: 'progression.take_perk', perkId: perk.id }}
                    label="Take perk"
                    size="sm"
                    variant="primary"
                    disabled={!perk.canTake}
                    disabledReason={perk.reason ?? (perk.taken ? 'You already have this perk.' : 'Not available yet.')}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Achievements() {
  const progression = useView<ProgressionView>('progression');
  const data = progression.data;
  const achievements = data?.achievements ?? [];
  const earned = achievements.filter((achievement) => achievement.earned);
  const pending = achievements.filter((achievement) => !achievement.earned);

  return (
    <div className="space-y-3">
      <Panel title="Earned" subtitle={`${earned.length} of ${achievements.length} recorded`}>
        {achievements.length === 0 ? (
          <EmptyState title="No achievements configured" body="This world has no achievement definitions." />
        ) : earned.length === 0 ? (
          <EmptyState title="Nothing earned yet" body="Achievements are recorded by the simulation as you play — a first trade, a first million, a first escape. They arrive on their own; there is nothing to claim." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {earned.map((achievement) => (
              <li key={achievement.id} className="rounded-panel border border-up/40 bg-up-soft/30 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">{achievement.name}</h3>
                  <Badge tone="up">earned{achievement.earnedDay !== null ? ` day ${achievement.earnedDay}` : ''}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-dim">{achievement.description}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Still open" subtitle="What the simulation is watching for">
        {pending.length === 0 ? (
          <EmptyState title="Everything is earned" body="Every achievement in this world is on your record." />
        ) : (
          <Table label="Open achievements">
            <thead>
              <tr>
                <Th>Achievement</Th>
                <Th>Requirement</Th>
                <Th align="right">Progress</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((achievement) => (
                <Tr key={achievement.id}>
                  <Td>
                    <span className="text-sm text-ink">{achievement.name}</span>
                    <span className="block text-[11px] text-ink-faint">{achievement.description}</span>
                  </Td>
                  <Td className="text-xs text-ink-dim">
                    {achievement.metrics.map((metric) => `${humanise(metric.metric)} ${metric.op} ${num(metric.target)}`).join(' · ')}
                  </Td>
                  <Td align="right">
                    <span className="tnum text-xs">
                      {achievement.metrics.map((metric) => `${num(metric.current)}/${num(metric.target)}`).join(' · ')}
                    </span>
                    <Meter value={achievement.progress} tone="gold" label={`${achievement.name} progress`} height={4} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Standing() {
  const progression = useView<ProgressionView>('progression');
  const { state } = useGame();
  const data = progression.data;
  const [title, setTitle] = useState('');

  const reputation = Object.entries(data?.reputation ?? {});
  /* The titles the simulation has actually granted; anything else the server refuses. */
  const earnedTitles = state?.player.progression.titles ?? [];
  const max = Math.max(1, ...reputation.map(([, value]) => Math.abs(value)));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Reputation" subtitle="Seven audiences, and they do not agree with each other">
        {reputation.length === 0 ? (
          <EmptyState title="No standing recorded" body="Reputation appears here as you deal with people who keep accounts." />
        ) : (
          <ul className="space-y-2">
            {reputation.map(([dimension, value]) => (
              <li key={dimension}>
                <Meter
                  label={humanise(dimension)}
                  value={Math.abs(value) / max}
                  display={num(value)}
                  tone={value < 0 ? 'down' : value > 0 ? 'up' : 'info'}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-faint">
          Criminal and digital standing open doors that legal standing closes, and the reverse. The simulation weighs them
          separately — there is no single “reputation” number.
        </p>
      </Panel>

      <div className="space-y-3">
        <Panel title="Title" subtitle="What the world calls you">
          <dl>
            <KeyValue label="Current title">{data?.title ?? '—'}</KeyValue>
            <KeyValue label="Level">{num(data?.level ?? 0)}</KeyValue>
          </dl>
          {earnedTitles.length > 1 && (
            <div className="mt-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Titles you have earned</h3>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {earnedTitles.map((earned) => (
                  <Button key={earned} size="sm" variant="secondary" onClick={() => setTitle(earned)} disabled={earned === data?.title}>
                    {earned}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <label htmlFor="title-input" className="mt-2 block text-xs">
            <span className="mb-1 block text-ink-dim">New title</span>
            <Input id="title-input" value={title} maxLength={64} placeholder={data?.title ?? 'Operator'} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="mt-2">
            <CommandButton
              intent={{ type: 'progression.set_title', title: title.trim() }}
              label="Set title"
              size="sm"
              variant="secondary"
              disabled={title.trim().length === 0}
              disabledReason="Type the title you want first."
              onDone={(outcome) => {
                if (outcome.ok) setTitle('');
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">
            Titles are cosmetic, and the server only accepts one you have actually earned — {earnedTitles.length} so far. The world reads
            them back to you in notifications and reports.
          </p>
        </Panel>

        <Panel title="Active modifiers" subtitle="Everything your skills and perks are currently doing">
          {Object.keys(data?.resolvedModifiers ?? {}).length === 0 ? (
            <p className="text-xs text-ink-faint">No modifiers are active yet — learn a skill or take a perk and the resolved totals appear here.</p>
          ) : (
            <Table label="Resolved modifiers">
              <thead>
                <tr>
                  <Th>Modifier</Th>
                  <Th align="right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data?.resolvedModifiers ?? {}).map(([key, value]) => (
                  <Tr key={key}>
                    <Td className="text-xs text-ink-dim">{humanise(key)}</Td>
                    <Td align="right" className={`tnum text-xs ${value < 0 ? 'text-down' : 'text-up'}`}>
                      {value > 0 ? '+' : ''}
                      {num(value, 3)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Prestige() {
  const progression = useView<ProgressionView>('progression');
  const facts = progression.data?.prestigeFacts;
  /*
   * The last handover attempt, as the server answered it.
   *
   * A refusal is the outcome a player is most likely to hit here — the thresholds are
   * deliberately far away — so the panel keeps the server's own reason on the page rather
   * than only flashing it in a toast. `ok:false` is never rendered as a success.
   */
  const [attempt, setAttempt] = useState<{ ok: boolean; message: string | null } | null>(null);
  if (!facts) return <Panel title="Prestige">{progression.error ? <InlineNote tone="down">{progression.error.message}</InlineNote> : <p className="text-xs text-ink-faint">Reading prestige thresholds…</p>}</Panel>;

  const netWorthProgress = Math.min(1, facts.netWorthRequirement > 0 ? facts.netWorth / facts.netWorthRequirement : 1);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Hand over the empire" subtitle="Start again with a permanent bonus, keeping nothing else">
        <p className="text-sm leading-relaxed text-ink-dim">
          Prestige ends this run deliberately. Your companies, holdings, cash and standing are gone; what you keep is a legacy bonus
          on everything the next run earns. The thresholds below are the server&rsquo;s, and the handover itself is validated there — this
          screen only reports what it would say.
        </p>
        <dl className="mt-2">
          <KeyValue label="Prestiges so far">{`${num(facts.count)} / ${num(facts.maxPrestiges)}`}</KeyValue>
          <KeyValue label="Legacy bonus" tone={facts.legacyBonus > 0 ? 'text-up' : undefined}>
            {pct(facts.legacyBonus, { from: 'fraction', decimals: 1 })}
          </KeyValue>
          <KeyValue label="Bonus cap">{pct(facts.legacyBonusCap, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Minimum run length">{`${num(facts.minDaysBetween)} days (now day ${num(facts.day)})`}</KeyValue>
          <KeyValue label="Last prestige">{facts.lastPrestigeDay === null ? 'never' : `day ${num(facts.lastPrestigeDay)}`}</KeyValue>
        </dl>
        <div className="mt-2">
          <CommandButton
            intent={{ type: 'progression.prestige' }}
            label="Prestige this run"
            variant="danger"
            confirm={{
              title: 'Prestige and end this run?',
              body: 'This is irreversible. The save continues with a new run at level 1, your assets are surrendered, and the legacy bonus is applied to what you earn next. The server checks every threshold before it happens and will refuse if one is unmet.',
              confirmLabel: 'Prestige',
              destructive: true,
            }}
            onDone={(result) => setAttempt({ ok: result.ok, message: result.message ?? null })}
          />
        </div>
        {attempt && attempt.ok && (
          <InlineNote tone="up">
            <strong>The handover went through.</strong> The run you were playing has ended and the save continues under your heir — this panel is reading the new count now.
          </InlineNote>
        )}
        {attempt && !attempt.ok && (
          <InlineNote tone="down">
            <strong>Prestige was refused — the action did not complete.</strong>{' '}
            {attempt.message ?? 'The server gave no reason for the refusal.'} Nothing was handed over: the estate is still yours and the run continues as it was.
          </InlineNote>
        )}
      </Panel>

      <Panel title="What the server will check" subtitle="Requirements are enforced on the handover, not on this screen">
        <div className="space-y-3">
          <div>
            <Progress value={netWorthProgress} tone={netWorthProgress >= 1 ? 'up' : 'gold'} label="Net worth requirement" />
            <p className="mt-1 text-xs text-ink-dim">
              Net worth {money(facts.netWorth)} of {money(facts.netWorthRequirement)} required.
            </p>
          </div>
          <dl>
            <KeyValue label="Outstanding debt" tone={facts.outstandingDebt > 0 ? 'text-down' : undefined}>
              {facts.outstandingDebt > 0 ? money(facts.outstandingDebt) : 'clear'}
            </KeyValue>
            <KeyValue label="Debts must be settled">{facts.requireDebtsSettled ? 'yes' : 'no'}</KeyValue>
            <KeyValue label="Run length">{`day ${num(facts.day)}`}</KeyValue>
          </dl>
          {facts.outstandingDebt > 0 && facts.requireDebtsSettled && (
            <InlineNote tone="warn">Prestige will be refused while you owe {money(facts.outstandingDebt)}. Settle the debt first — the Finance screen is where loans live.</InlineNote>
          )}
          {facts.netWorthRequirement > 0 && facts.netWorth < facts.netWorthRequirement && (
            <InlineNote tone="warn">
              Prestige will be refused until the empire is worth {money(facts.netWorthRequirement)} — you are {money(facts.netWorthRequirement - facts.netWorth)} short.
              The server re-checks this at the moment of the handover, so nothing is lost by reading it here.
            </InlineNote>
          )}
          {facts.day < facts.minDaysBetween && (
            <InlineNote tone="warn">Prestige will be refused before day {num(facts.minDaysBetween)}.</InlineNote>
          )}
          {facts.count >= facts.maxPrestiges && <InlineNote tone="warn">You have used every prestige this world allows.</InlineNote>}
        </div>
      </Panel>
    </div>
  );
}
