/**
 * Navigation registry.
 *
 * One declaration drives the desktop rail, the mobile drawer and the dashboard's
 * "systems" grid, so a new screen cannot appear in one place and be missing in another.
 * The grouping is the player's mental model — act, trade, build, protect, self — rather
 * than the alphabetical order of the API.
 */
import type { IconName } from '../ui/icons';

export interface NavItem {
  /** Path segment under `/games/[gameId]`. Empty string is the dashboard. */
  slug: string;
  label: string;
  icon: IconName;
  /** One line for the dashboard grid: what the screen is for. */
  blurb: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'command',
    label: 'Command',
    items: [
      { slug: '', label: 'Dashboard', icon: 'Dashboard', blurb: 'Position, opportunities and what needs attention now.' },
      { slug: 'world', label: 'World & Travel', icon: 'World', blurb: 'The map, route pricing and moving between cities.' },
      { slug: 'news', label: 'News & Events', icon: 'News', blurb: 'World events, shocks and why prices moved.' },
    ],
  },
  {
    id: 'trade',
    label: 'Trade & Operations',
    items: [
      { slug: 'market', label: 'Market', icon: 'Market', blurb: 'Prices, spreads and order entry at your location.' },
      { slug: 'inventory', label: 'Inventory', icon: 'Inventory', blurb: 'What you hold, where it is and what binds you.' },
      { slug: 'logistics', label: 'Logistics', icon: 'Truck', blurb: 'Vehicles, shipments in transit and freight cover.' },
      { slug: 'properties', label: 'Properties', icon: 'Property', blurb: 'Owned premises, listings and storage capacity.' },
      { slug: 'businesses', label: 'Businesses', icon: 'Store', blurb: 'Operating ventures, their takings and daily result.' },
      { slug: 'production', label: 'Production', icon: 'Factory', blurb: 'Recipe lines, input cover and output value.' },
    ],
  },
  {
    id: 'empire',
    label: 'Empire',
    items: [
      { slug: 'finance', label: 'Finance', icon: 'Bank', blurb: 'Accounts, credit, loans, tax and laundering fronts.' },
      { slug: 'stocks', label: 'Stocks', icon: 'Stocks', blurb: 'Listed companies, holdings and portfolio risk.' },
      { slug: 'crypto', label: 'Crypto', icon: 'Crypto', blurb: 'Digital assets, exchanges, staking and mining rigs.' },
      { slug: 'crew', label: 'Crew', icon: 'Crew', blurb: 'Employees, skills, payroll and loyalty risk.' },
      { slug: 'automation', label: 'Automation', icon: 'Automation', blurb: 'Standing orders delegated to your managers.' },
      { slug: 'missions', label: 'Missions', icon: 'Mission', blurb: 'Contracts on offer, active work and rewards.' },
      { slug: 'factions', label: 'Factions', icon: 'Faction', blurb: 'Standing, services, territory and conflict.' },
    ],
  },
  {
    id: 'risk',
    label: 'Risk',
    items: [
      { slug: 'underground', label: 'Underground', icon: 'Underground', blurb: 'Darknet access, listings and escrow — if unlocked.' },
      { slug: 'combat', label: 'Combat', icon: 'Combat', blurb: 'Any live encounter, resolved turn by turn.' },
    ],
  },
  {
    id: 'self',
    label: 'Progress',
    items: [
      { slug: 'progression', label: 'Progression', icon: 'Progression', blurb: 'Level, skills, perks, achievements and reputation.' },
      { slug: 'save', label: 'Save & Versions', icon: 'Save', blurb: 'Version history, restores and the current save.' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function gameHref(gameId: string, slug: string): string {
  return `/games/${encodeURIComponent(gameId)}${slug ? `/${slug}` : ''}`;
}

/** The nav item a pathname belongs to, for the active state. */
export function activeSlug(pathname: string, gameId: string): string {
  const base = `/games/${encodeURIComponent(gameId)}`;
  if (!pathname.startsWith(base)) return '';
  const rest = pathname.slice(base.length).replace(/^\//, '');
  return rest.split('/')[0] ?? '';
}
