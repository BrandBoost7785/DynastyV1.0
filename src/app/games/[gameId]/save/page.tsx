'use client';

/**
 * Save & versions.
 *
 * The server keeps every version of a save. This screen is the one place a player can see
 * that history and roll back to it, and it is built around three facts:
 *
 *  • **The list is metadata only.** Stored save documents never reach the browser, so there
 *    is nothing here a client could tamper with — only version numbers, days, net worth,
 *    timestamps, sizes and the reason the version was written.
 *  • **Restoring is a confirmed, conflict-checked command.** It carries the version this
 *    tab last saw (`expectedVersion`), so a second tab cannot roll the game back underneath
 *    the first. A refusal is a conflict, and a conflict means "refetch and look again",
 *    never "retry blindly".
 *  • **Restoring is forward-only.** The rollback itself is written as a *new* version, so
 *    the history being restored from is never overwritten. That is why the current version
 *    number can go up after going back in time.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, newRequestId } from '../../../../lib/api-client';
import { useGame } from '../../../../lib/game-context';
import { invalidate, refetchQuery, useQuery } from '../../../../lib/query';
import { useToast } from '../../../../components/ui/toast';
import { ConfirmDialog } from '../../../../components/ui/dialog';
import { Badge, Button, Input, KeyValue, Panel, Stat, Table, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, ErrorState, InlineNote, LoadingState } from '../../../../components/ui/states';
import { age, dateTime, humanise, money, num } from '../../../../lib/format';
import type { SaveVersionRow } from '../../../../lib/game-data';

interface VersionsPayload {
  gameId: string;
  currentVersion: number;
  versions: SaveVersionRow[];
}

const HISTORY_LIMIT = 100;

export default function SavePage() {
  const { gameId, meta, state, refresh, apply } = useGame();
  const toast = useToast();
  const router = useRouter();
  const key = `versions:${gameId}`;

  const versions = useQuery<VersionsPayload>(key, () => api.versions(gameId, HISTORY_LIMIT), { staleTime: 0 });
  const [pending, setPending] = useState<SaveVersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState('');

  const rows = versions.data?.versions ?? [];
  const current = versions.data?.currentVersion ?? meta?.version ?? 0;
  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter((row) => String(row.version).includes(term) || (row.reason ?? '').toLowerCase().includes(term) || `day ${row.day}`.includes(term))
    : rows;

  const currentRow = rows.find((row) => row.version === current) ?? null;

  // A scalar, so the callback's dependencies are exactly what it reads. Depending on
  // `meta?.version` directly makes the compiler's inferred dependency (`meta`) disagree
  // with the declared one, which is an error under the project's React Compiler rules.
  const seenVersion = meta?.version ?? 0;

  const restore = useCallback(
    async (target: SaveVersionRow) => {
      setRestoring(true);
      try {
        /*
         * `meta.version` is the version this tab has actually seen. Sending it — rather
         * than the newest number in the list — is what makes the server's conflict check
         * meaningful: if another tab wrote in the meantime the restore is refused instead
         * of silently discarding that work.
         */
        const result = await api.restoreVersion(gameId, target.version, seenVersion, newRequestId());
        apply(result.state, result.state.meta);
        invalidate(`views:${gameId}`);
        await refetchQuery(key, () => api.versions(gameId, HISTORY_LIMIT));
        toast.push({
          tone: 'success',
          title: `Restored to version ${result.restoredFrom}`,
          body: `The save is now at version ${result.state.meta.version} on day ${result.state.meta.day}. Everything the restore replaced is still in the history.`,
        });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError('internal_error', 'The restore could not be completed.', 0);
        if (apiError.status === 401 || apiError.code === 'not_authenticated') {
          toast.push({ tone: 'warning', title: 'Session expired', body: 'Sign in again to restore this save.' });
          router.push(`/login?next=${encodeURIComponent(`/games/${gameId}/save`)}`);
          return;
        }
        if (apiError.status === 409 || apiError.code === 'conflict') {
          // The established conflict behaviour: tell the player, then show them the truth.
          toast.push({
            tone: 'warning',
            title: 'Game state changed. Refreshing your market data.',
            body: 'The save moved on while you were looking at the history, so the restore was refused rather than applied over newer progress. The latest version is loading now.',
            sticky: true,
          });
          await refresh();
          invalidate(`views:${gameId}`);
          await refetchQuery(key, () => api.versions(gameId, HISTORY_LIMIT));
          return;
        }
        toast.push({ tone: 'danger', title: 'Restore refused', body: apiError.message });
      } finally {
        setRestoring(false);
        setPending(null);
      }
    },
    [apply, gameId, key, seenVersion, refresh, router, toast],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Progress</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Save &amp; versions</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {meta ? `Version ${num(current)} · day ${num(meta.day)} · turn ${num(meta.turn)} · ${humanise(meta.status)}` : 'Reading the save record…'}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void refetchQuery(key, () => api.versions(gameId, HISTORY_LIMIT))} loading={versions.refreshing}>
          Refresh history
        </Button>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Current version" value={num(current)} hint={currentRow ? age(currentRow.savedAt) : 'the live save'} tone="gold" />
        <Stat label="Day / turn" value={`${num(state?.world.day ?? meta?.day ?? 0)} / ${num(meta?.turn ?? 0)}`} hint="the point history would roll back to" />
        <Stat label="Save status" value={humanise(meta?.status ?? 'unknown')} hint={meta ? `last written ${age(meta.updatedAt)}` : '—'} />
        <Stat
          label="History"
          value={`${num(rows.length)} version${rows.length === 1 ? '' : 's'}`}
          hint={currentRow ? `${(currentRow.sizeBytes / 1024).toFixed(0)} kB stored per version` : 'every write is kept'}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="This save" subtitle="Identity and current position" className="lg:col-span-1">
          <dl>
            <KeyValue label="Game">{meta?.name ?? gameId}</KeyValue>
            <KeyValue label="Save id">{gameId}</KeyValue>
            <KeyValue label="Version">{num(current)}</KeyValue>
            <KeyValue label="Day">{num(state?.world.day ?? meta?.day ?? 0)}</KeyValue>
            <KeyValue label="Turn">{num(meta?.turn ?? 0)}</KeyValue>
            <KeyValue label="Status">{humanise(meta?.status ?? 'unknown')}</KeyValue>
            {meta?.createdAt && <KeyValue label="Started">{dateTime(meta.createdAt)}</KeyValue>}
            {meta?.updatedAt && <KeyValue label="Last written">{dateTime(meta.updatedAt)}</KeyValue>}
          </dl>
          <InlineNote tone="info">
            Versions are written by the server after every accepted command: a trade, a journey, an advance. Rolling back is a
            server operation — nothing in this browser holds a copy of the save.
          </InlineNote>
        </Panel>

        <Panel
          title="Version history"
          subtitle="Newest first — every write the server kept"
          className="lg:col-span-2"
          actions={
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <span>Filter</span>
              <Input aria-label="Filter versions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Version, day or reason" className="w-44" />
            </label>
          }
        >
          {versions.error && versions.data === undefined && (
            <ErrorState error={versions.error} onRetry={() => void refetchQuery(key, () => api.versions(gameId, HISTORY_LIMIT))} label="Could not load the version history" />
          )}
          {versions.data === undefined && versions.error === null && <LoadingState label="Loading version history" rows={6} cols={5} />}
          {versions.data && rows.length === 0 && (
            <EmptyState title="No versions recorded" body="The server writes a version after every accepted command. If this is empty, nothing has been written yet." />
          )}
          {rows.length > 0 && visible.length === 0 && <EmptyState title="No version matches that filter" body="Clear the filter to see the whole history." />}
          {visible.length > 0 && (
            <Table label="Saved versions">
              <thead>
                <tr>
                  <Th align="right">Version</Th>
                  <Th align="right">Day</Th>
                  <Th align="right">Net worth</Th>
                  <Th>Written</Th>
                  <Th>Reason</Th>
                  <Th align="right">Size</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <Tr key={row.version} highlight={row.version === current}>
                    <Td align="right" className="tnum">
                      {row.version === current ? <Badge tone="gold">current</Badge> : num(row.version)}
                    </Td>
                    <Td align="right" className="tnum text-xs">{num(row.day)}</Td>
                    <Td align="right" className="tnum text-xs">{money(row.netWorth)}</Td>
                    <Td className="text-xs text-ink-dim">
                      {dateTime(row.savedAt)}
                      <span className="block text-[11px] text-ink-faint">{age(row.savedAt)}</span>
                    </Td>
                    <Td className="text-xs text-ink-dim">{humanise(row.reason)}</Td>
                    <Td align="right" className="tnum text-xs text-ink-faint">{(row.sizeBytes / 1024).toFixed(0)} kB</Td>
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={row.version === current || restoring}
                        title={row.version === current ? 'This is the version you are playing.' : `Roll the save back to version ${row.version}`}
                        onClick={() => setPending(row)}
                      >
                        Restore
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            Showing {visible.length} of {rows.length} kept version{rows.length === 1 ? '' : 's'}
            {rows.length >= HISTORY_LIMIT ? ` (capped at ${HISTORY_LIMIT})` : ''} · a restore is written as a new version, so the
            history you restore from is never destroyed.
          </p>
        </Panel>
      </div>

      <ConfirmDialog
        open={pending !== null}
        busy={restoring}
        destructive
        title={pending ? `Restore version ${pending.version}?` : 'Restore version?'}
        confirmLabel={pending ? `Restore day ${pending.day}` : 'Restore'}
        body={
          pending ? (
            <>
              <p>
                The live save will be replaced by the state recorded at version {pending.version} — day {num(pending.day)}, net worth{' '}
                {money(pending.netWorth)}, written {age(pending.savedAt)}.
              </p>
              <p className="mt-2">
                Everything accepted since then is left behind: trades, journeys and days advanced. The replaced state stays in this
                history, and the restore itself is recorded as a new version rather than overwriting anything.
              </p>
              <p className="mt-2 text-ink-faint">
                Your balance, holdings and position will update as soon as the server answers. If the save has moved on since this
                page loaded, the restore is refused and the current state is reloaded instead.
              </p>
            </>
          ) : null
        }
        onClose={() => (restoring ? undefined : setPending(null))}
        onConfirm={() => {
          if (pending) void restore(pending);
        }}
      />
    </div>
  );
}
