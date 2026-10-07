'use client';

/**
 * Factions.
 *
 * The world's powers are not scenery: they own the cities the player trades in, they set
 * the price of being tolerated, and they hand out the services — legal cover, intelligence,
 * contracts — that make the difference between an operator and a fugitive.
 *
 * The screen is deliberately read-mostly. Standing is earned by playing, not by clicking a
 * slider, so the only commands offered here are the ones the server actually implements:
 * accepting or declining an offer, paying tribute as a gift, and requesting a service the
 * faction has said it provides.
 */
import { useMemo, useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { CommandButton } from '../../../../components/game/view-panel';
import { Badge, Input, KeyValue, Meter, Panel, Progress, Select, Stat, Table, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct, shortId } from '../../../../lib/format';
import type { FactionRow, FactionsView } from '../../../../lib/game-data';

type Sort = 'standing' | 'power' | 'mood' | 'name';

/** Standing swings −100…100; the label is the server's, the tone is presentation. */
function standingTone(standing: number): 'up' | 'down' | 'warn' | 'neutral' {
  if (standing >= 25) return 'up';
  if (standing <= -25) return 'down';
  if (standing < 0) return 'warn';
  return 'neutral';
}

export default function FactionsPage() {
  const factions = useView<FactionsView>('factions');
  const overview = factions.data?.overview;
  const [sort, setSort] = useState<Sort>('standing');
  const [search, setSearch] = useState('');
  const [openFaction, setOpenFaction] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = [...(factions.data?.factions ?? [])];
    const term = search.trim().toLowerCase();
    const filtered = term ? list.filter((faction) => faction.name.toLowerCase().includes(term) || faction.kindLabel.toLowerCase().includes(term)) : list;
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'power') return b.power - a.power;
      if (sort === 'mood') return a.mood - b.mood;
      return b.playerStanding - a.playerStanding;
    });
  }, [factions.data?.factions, search, sort]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Empire</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Factions</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {overview
              ? `${overview.total} powers · ${overview.wars.length} active wars · pressure here ${num(overview.factionPressure, 2)}`
              : 'Reading the balance of power…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Search</span>
            <Input aria-label="Search factions" value={search} placeholder="Name or kind" onChange={(event) => setSearch(event.target.value)} className="w-40" />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Sort</span>
            <Select aria-label="Sort factions" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="standing">Your standing</option>
              <option value="power">Power</option>
              <option value="mood">Least friendly</option>
              <option value="name">Name</option>
            </Select>
          </label>
        </div>
      </header>

      {overview && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Controls this location"
            value={overview.controllerHere?.name ?? 'Nobody'}
            hint={overview.controllerHere ? overview.controllerHere.kind : 'unclaimed or contested ground'}
            tone={overview.controllerHere ? 'gold' : 'default'}
          />
          <Stat label="Pressure on you" value={num(overview.factionPressure, 2)} hint="rises with heat and with factions who dislike you" tone={overview.factionPressure > 1 ? 'warn' : 'default'} />
          <Stat label="Open offers" value={num(overview.offersOpen)} hint={`${overview.tributeDemands} tribute demand${overview.tributeDemands === 1 ? '' : 's'}`} />
          <Stat
            label="Best / worst standing"
            value={overview.bestStanding ? `${num(overview.bestStanding.standing)} / ${num(overview.worstStanding?.standing ?? 0)}` : '—'}
            hint={overview.bestStanding ? `${overview.bestStanding.name} / ${overview.worstStanding?.name ?? '—'}` : 'no relations yet'}
          />
        </div>
      )}

      {overview && (overview.wars.length > 0 || overview.servicesAvailable.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {overview.wars.length > 0 && (
            <Panel title="Active wars" subtitle="Pairs whose relations have collapsed past the point of trade">
              <ul className="space-y-1">
                {overview.wars.slice(0, 8).map((war) => (
                  <li key={`${war.a}-${war.b}`} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="text-ink-dim">
                      {war.a} <span className="text-ink-faint">vs</span> {war.b}
                    </span>
                    <span className="tnum text-down">{num(war.sinceBalance, 1)}</span>
                  </li>
                ))}
              </ul>
              {overview.wars.length > 8 && <p className="mt-1 text-[11px] text-ink-faint">+{overview.wars.length - 8} more</p>}
            </Panel>
          )}
          {overview.servicesAvailable.length > 0 && (
            <Panel title="Services you can call on" subtitle="Factions whose standing with you clears their own threshold">
              <ul className="flex flex-wrap gap-1.5">
                {overview.servicesAvailable.map((entry) => (
                  <li key={`${entry.faction}-${entry.service}`}>
                    <Badge tone="gold">
                      {entry.faction}: {humanise(entry.service)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-ink-faint">
                Requesting a service is a command, and the faction charges for it — the price and the risk are theirs to set.
              </p>
            </Panel>
          )}
        </div>
      )}

      <Panel title="The powers" subtitle="Sorted by the column you chose; expand one to see what it wants and what it offers">
        {factions.data === undefined && factions.error === null && <p className="text-xs text-ink-faint">Loading factions…</p>}
        {factions.error && factions.data === undefined && <InlineNote tone="down">Could not load faction data: {factions.error.message}</InlineNote>}
        {factions.data && rows.length === 0 && search.trim() !== '' && (
          <EmptyState title="No faction matches that search" body="Clear the search box or pick a different kind of organisation." />
        )}
        {factions.data && (factions.data.factions.length === 0) && search.trim() === '' && (
          <EmptyState
            title="No factions in this world yet"
            body="Nothing organised has taken shape around you. Factions form, grow and move as the simulation runs — keep trading, moving and advancing days and this board will fill with powers that have an opinion about you."
          />
        )}
        {rows.length > 0 && (
          <Table label="Factions">
            <thead>
              <tr>
                <Th>Faction</Th>
                <Th>Kind</Th>
                <Th align="right">Standing</Th>
                <Th align="right">Power</Th>
                <Th align="right">Aggression</Th>
                <Th align="right">Mood</Th>
                <Th>Territory</Th>
                <Th align="right">Offers</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((faction) => (
                <FactionRows
                  key={faction.id}
                  faction={faction}
                  interests={factions.data?.interests[faction.id] ?? []}
                  open={openFaction === faction.id}
                  onToggle={() => setOpenFaction(openFaction === faction.id ? null : faction.id)}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function FactionRows({
  faction,
  interests,
  open,
  onToggle,
}: {
  faction: FactionRow;
  interests: { category: string; commodities: number; exampleValue: number }[];
  open: boolean;
  onToggle: () => void;
}) {
  const here = faction.territory.some((place) => place.here);

  return (
    <>
      <Tr highlight={open}>
        <Td>
          <span className="text-sm text-ink">{faction.name}</span>
          {faction.controlsCurrentLocation && (
            <span className="ml-2">
              <Badge tone="gold">rules here</Badge>
            </span>
          )}
        </Td>
        <Td className="text-xs text-ink-dim">{faction.kindLabel}</Td>
        <Td align="right">
          <span className="tnum text-sm">{num(faction.playerStanding)}</span>
          <Badge tone={standingTone(faction.playerStanding)} className="ml-1.5">
            {faction.standingLabel}
          </Badge>
        </Td>
        <Td align="right" className="tnum">{num(faction.power, 2)}</Td>
        <Td align="right" className="tnum">{num(faction.aggression, 2)}</Td>
        <Td align="right">
          <Meter value={faction.mood} tone={faction.mood < 0.35 ? 'down' : faction.mood < 0.6 ? 'warn' : 'up'} display={num(faction.mood, 2)} label={`${faction.name} mood`} />
        </Td>
        <Td className="text-xs text-ink-dim">
          {faction.territory.length === 0 ? '—' : here ? `${faction.territory.find((place) => place.here)?.name} (here)` : `${faction.territory[0]!.name}${faction.territory.length > 1 ? ` +${faction.territory.length - 1}` : ''}`}
        </Td>
        <Td align="right" className="tnum">{faction.offers.length}</Td>
        <Td align="right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="text-xs text-gold hover:underline"
          >
            {open ? 'Hide' : 'Detail'}
          </button>
        </Td>
      </Tr>
      {open && (
        <tr>
          <td colSpan={9} className="border-b border-line bg-panel-2/30 px-3 pb-3">
            <FactionDetail faction={faction} interests={interests} />
          </td>
        </tr>
      )}
    </>
  );
}

function FactionDetail({ faction, interests }: { faction: FactionRow; interests: { category: string; commodities: number; exampleValue: number }[] }) {
  const canGift = faction.tributeOwed > 0;
  const [giftAmount, setGiftAmount] = useState(() => Math.max(500, Math.round(faction.tributeOwed || 1000)));

  return (
    <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-3">
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">What they are</h4>
        <p className="text-xs leading-relaxed text-ink-dim">{faction.description}</p>
        <dl>
          <KeyValue label="Resources">{money(faction.resources, { compact: true })}</KeyValue>
          <KeyValue label="Recruitment needs">{`standing ${num(faction.recruitmentRequirement)}`}</KeyValue>
          <KeyValue label="Tribute owed" tone={faction.tributeOwed > 0 ? 'text-warn' : undefined}>
            {faction.tributeOwed > 0 ? money(faction.tributeOwed) : 'nothing outstanding'}
          </KeyValue>
          <KeyValue label="Services">{faction.services.length === 0 ? '—' : faction.services.map(humanise).join(', ')}</KeyValue>
        </dl>
        {faction.goals.length > 0 && (
          <>
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Stated goals</h4>
            <ul className="list-inside list-disc text-xs text-ink-dim">
              {faction.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Relations</h4>
        {faction.atWarWith.length > 0 && (
          <p className="text-xs">
            <span className="text-down">At war with </span>
            <span className="text-ink-dim">{faction.atWarWith.map((enemy) => enemy.name).join(', ')}</span>
          </p>
        )}
        {faction.alliedWith.length > 0 && (
          <p className="text-xs">
            <span className="text-up">Aligned with </span>
            <span className="text-ink-dim">{faction.alliedWith.map((ally) => ally.name).join(', ')}</span>
          </p>
        )}
        {faction.relations.length > 0 && (
          <ul className="space-y-1">
            {faction.relations.map((relation) => (
              <li key={relation.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink-dim">{relation.name}</span>
                  <span className={`tnum ${relation.value < 0 ? 'text-down' : 'text-up'}`}>{num(relation.value, 1)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Interests</h4>
        {faction.interests.length === 0 ? (
          <p className="text-xs text-ink-faint">This faction has no declared commodity interests.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1.5">
              {faction.interests.map((interest) => (
                <li key={interest}>
                  <Badge tone="info">{humanise(interest)}</Badge>
                </li>
              ))}
            </ul>
            {interests.length > 0 && (
              <ul className="mt-1 space-y-1">
                {interests.map((interest) => (
                  <li key={interest.category} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-ink-dim">
                        {humanise(interest.category)} · {interest.commodities} commodities
                      </span>
                      <span className="tnum text-ink-faint">from {money(interest.exampleValue, { compact: true })}</span>
                    </div>
                    <Progress value={interest.commodities / Math.max(1, ...interests.map((entry) => entry.commodities))} tone="info" label={`${humanise(interest.category)} depth`} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Dealings</h4>
        {faction.offers.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing on the table. Offers appear as the world reacts to your standing and to events.</p>
        ) : (
          <ul className="space-y-2">
            {faction.offers.map((offer) => (
              <li key={offer.id} className="rounded border border-line bg-panel px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{offer.kindLabel}</span>
                  <span className="text-[11px] text-ink-faint">{offer.daysLeft} day(s) left</span>
                </div>
                <p className="mt-1 text-xs text-ink-dim">{offer.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                  <span className="tnum">{money(offer.reward)}</span>
                  <span className={offer.standingDelta < 0 ? 'text-down' : 'text-up'}>
                    standing {offer.standingDelta > 0 ? '+' : ''}
                    {num(offer.standingDelta)}
                  </span>
                  <span>risk {pct(offer.risk, { from: 'fraction', decimals: 0 })}</span>
                  <span>expires day {num(offer.expiresDay)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <CommandButton intent={{ type: 'faction.accept_offer', factionId: faction.id, offerId: offer.id }} label="Accept" size="sm" variant="success" />
                  <CommandButton intent={{ type: 'faction.decline_offer', factionId: faction.id, offerId: offer.id }} label="Decline" size="sm" variant="secondary" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {faction.services.length > 0 && (
          <>
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Ask for a service</h4>
            {faction.canUseServices ? (
              <ul className="flex flex-wrap gap-1.5">
                {faction.services.map((service) => (
                  <li key={service}>
                    <CommandButton
                      intent={{ type: 'faction.request_service', factionId: faction.id, service }}
                      label={humanise(service)}
                      size="sm"
                      variant="secondary"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <InlineNote tone="warn">
                Their services are closed to you: {faction.name} wants standing {num(faction.recruitmentRequirement)} and you are at {num(faction.playerStanding)}.
              </InlineNote>
            )}
          </>
        )}

        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{canGift ? 'Pay tribute' : 'Goodwill payment'}</h4>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={`gift-${faction.id}`} className="text-xs">
            <span className="mb-1 block text-ink-dim">Amount</span>
            <Input
              id={`gift-${faction.id}`}
              type="number"
              min={1}
              value={giftAmount}
              onChange={(event) => setGiftAmount(Math.max(0, Number(event.target.value)))}
              className="w-32"
            />
          </label>
          <CommandButton
            intent={{ type: 'faction.gift', factionId: faction.id, amount: giftAmount }}
            label={canGift ? 'Pay tribute' : `Send ${money(giftAmount)}`}
            size="sm"
            variant="primary"
            disabled={giftAmount <= 0}
            disabledReason="Enter an amount to send."
            confirm={{
              title: `Send ${money(giftAmount)} to ${faction.name}?`,
              body: canGift
                ? 'Tribute purchases toleration, not friendship: refusing it is what raises pressure on your operations here.'
                : 'A gift buys standing with them, up to a point. The server decides how much goodwill it is worth.',
              confirmLabel: 'Send money',
            }}
          />
        </div>
        <p className="text-[11px] text-ink-faint">
          Faction id <span className="tnum">{shortId(faction.id)}</span> · territory {faction.territory.length === 0 ? 'none' : faction.territory.map((place) => place.name).join(', ')}
        </p>
      </div>
    </div>
  );
}
