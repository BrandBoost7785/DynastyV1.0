'use client';

/**
 * Game library — the player's saves.
 *
 * Shows exactly what `GET /api/games` returns: one row per save, with its own day,
 * level, net worth and version. Creating a save goes through the same authoritative
 * endpoint the rest of the game uses (`POST /api/games`), so the seed the world is built
 * from is the server's, not the browser's guess.
 */
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, type SessionInfo } from '../../lib/api-client';
import type { SaveMetadata } from '../../persistence/types';
import { invalidate, useQuery } from '../../lib/query';
import { useToast } from '../ui/toast';
import { Badge, Button, Checkbox, Field, Input, Panel, Select } from '../ui/primitives';
import { ConfirmDialog } from '../ui/dialog';
import { EmptyState, ErrorState, InlineNote, LoadingState } from '../ui/states';
import { age, humanise, money, num } from '../../lib/format';

/** One row of `GET /api/games` — the server's own `SaveMetadata`. */
type GameListItem = SaveMetadata;

const DIFFICULTIES = [
  { id: 'relaxed', label: 'Relaxed', blurb: 'Softer enforcement, cheaper credit, more forgiving events.' },
  { id: 'standard', label: 'Standard', blurb: 'The balanced world the economy was tuned against.' },
  { id: 'hardcore', label: 'Hardcore', blurb: 'Tighter margins, heavier enforcement, harsher penalties.' },
  { id: 'brutal', label: 'Brutal', blurb: 'Everything against you. Survival is the achievement.' },
];

export function GameLibrary({ session }: { session: SessionInfo }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<GameListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [playerName, setPlayerName] = useState(session.user?.displayName ?? '');
  const [gameName, setGameName] = useState('');
  const [difficulty, setDifficulty] = useState('standard');
  const [seed, setSeed] = useState('');
  const [permadeath, setPermadeath] = useState(false);
  const [endless, setEndless] = useState(false);

  const games = useQuery<{ games: GameListItem[]; count: number }>('games:list', () => api.listGames());

  const create = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (creating) return;
      setCreating(true);
      setFormError(null);
      try {
        const created = await api.createGame({
          playerName: playerName.trim(),
          ...(gameName.trim() ? { gameName: gameName.trim() } : {}),
          ...(seed.trim() ? { seed: seed.trim() } : {}),
          difficulty: difficulty as 'relaxed' | 'standard' | 'hardcore' | 'brutal',
          permadeath,
          endless,
        });
        const gameId = created.game.meta.gameId;
        invalidate('games:');
        toast.push({ tone: 'success', title: 'New save created', body: `Day 0 at ${created.game.meta.locationId.replace(/_/g, ' ')}.` });
        router.push(`/games/${encodeURIComponent(gameId)}`);
      } catch (caught) {
        setFormError(caught instanceof ApiError ? caught.message : 'The save could not be created.');
      } finally {
        setCreating(false);
      }
    },
    [creating, difficulty, endless, gameName, permadeath, playerName, router, seed, toast],
  );

  const remove = useCallback(
    async (game: GameListItem) => {
      setDeleting(true);
      try {
        await api.deleteGame(game.gameId);
        toast.push({ tone: 'info', title: 'Save deleted', body: `${game.name} and its version history are gone.` });
        invalidate('games:');
      } catch (caught) {
        toast.push({ tone: 'danger', title: 'Could not delete the save', body: caught instanceof ApiError ? caught.message : 'The request failed.' });
      } finally {
        setDeleting(false);
        setPendingDelete(null);
      }
    },
    [toast],
  );

  const list = games.data?.games ?? [];
  const hasGames = list.length > 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Dynasty</p>
          <h1 className="text-2xl font-semibold text-ink">Your games</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Signed in as {session.user?.displayName ?? 'player'} ({session.auth} session).
          </p>
        </div>
        <Link href="/leaderboard" className="hidden text-sm text-gold hover:underline sm:block">
          Leaderboard →
        </Link>
      </header>

      {games.error && !games.data && <ErrorState error={games.error} onRetry={() => invalidate('games:')} label="Could not load your saves" />}
      {games.loading && !games.data && <LoadingState label="Loading your saves" rows={3} cols={5} />}

      {hasGames && (
        <section aria-label="Existing saves" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((game) => (
            <article key={game.gameId} className="rounded-panel border border-line bg-panel shadow-panel">
              <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-ink">{game.name}</h2>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {game.title} · level {game.level} · {game.difficulty}
                  </p>
                </div>
                <Badge tone={game.status === 'active' ? 'up' : 'warn'}>{game.status}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-sm">
                <div>
                  <dt className="text-[11px] text-ink-faint uppercase">Day</dt>
                  <dd className="tnum text-ink">{num(game.day)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-faint uppercase">Net worth</dt>
                  <dd className="tnum text-ink">{money(game.netWorth, { compact: true })}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] text-ink-faint uppercase">Last played</dt>
                  <dd className="text-ink-dim">
                    {humanise(game.locationId)} · {age(game.updatedAt)}
                  </dd>
                </div>
              </dl>
              <div className="flex items-center gap-2 border-t border-line px-4 py-3">
                <Button variant="primary" size="sm" onClick={() => router.push(`/games/${encodeURIComponent(game.gameId)}`)}>
                  Continue
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingDelete(game)}>
                  Delete
                </Button>
                <span className="tnum ml-auto text-[11px] text-ink-faint">v{game.version}</span>
              </div>
            </article>
          ))}
        </section>
      )}

      {games.data && !hasGames && (
        <EmptyState
          title="No games yet."
          body="Create your first save below. You start with ¤4,200 in cash, a small starter cargo and a single city's prices to learn — every other city prices the same goods differently."
        />
      )}

      <Panel title={hasGames ? 'Start another save' : 'Create a save'} subtitle="Each save is an independent world with its own seed, version history and leaderboard entry.">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          {formError && (
            <div className="sm:col-span-2">
              <InlineNote tone="down">{formError}</InlineNote>
            </div>
          )}
          <Field label="Player name" htmlFor="playerName" hint="Your character's name in this world.">
            <Input id="playerName" required minLength={1} maxLength={40} value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
          </Field>
          <Field label="Save name" hint="Optional — defaults to the server's own label." htmlFor="gameName">
            <Input id="gameName" maxLength={80} value={gameName} onChange={(event) => setGameName(event.target.value)} placeholder="e.g. Monsoon run" />
          </Field>
          <Field label="Difficulty" htmlFor="difficulty" hint={DIFFICULTIES.find((d) => d.id === difficulty)?.blurb}>
            <Select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              {DIFFICULTIES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="World seed" htmlFor="seed" hint="Optional. The same seed always generates the same world.">
            <Input id="seed" maxLength={64} value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="leave blank for a fresh world" />
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox
              label="Permadeath"
              hint="Death, imprisonment long enough, or bankruptcy ends the run permanently instead of letting you continue."
              checked={permadeath}
              onChange={setPermadeath}
            />
            <Checkbox label="Endless mode" hint="No victory ending — the world keeps running once you would otherwise have won." checked={endless} onChange={setEndless} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={creating} disabled={creating || playerName.trim().length === 0}>
              Create save
            </Button>
          </div>
        </form>
      </Panel>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        busy={deleting}
        destructive
        title="Delete this save?"
        confirmLabel="Delete permanently"
        body={
          <>
            <p>
              <span className="font-semibold text-ink">{pendingDelete?.name}</span> — day {pendingDelete?.day}, {money(pendingDelete?.netWorth ?? 0)} net worth.
            </p>
            <p className="mt-2">
              Every version in its history is removed as well. This cannot be undone, and nothing about it can be recovered from the browser.
            </p>
          </>
        }
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
      />
    </div>
  );
}
