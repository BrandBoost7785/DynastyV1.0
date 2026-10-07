/**
 * Icon set.
 *
 * Hand-drawn 24px stroke icons so the interface needs no icon dependency and every
 * glyph shares one optical weight. They are decorative: each usage site supplies its
 * own accessible label, or pairs the icon with visible text.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Dashboard: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z" />
    </Svg>
  ),
  Market: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 17l5-5 3 3 5-6 5 5" />
      <path d="M3 21h18" />
    </Svg>
  ),
  World: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
    </Svg>
  ),
  Inventory: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </Svg>
  ),
  Truck: (p: IconProps) => (
    <Svg {...p}>
      <path d="M2 17V6h11v11zM13 9h4l4 4v4h-8z" />
      <circle cx="6" cy="18.5" r="1.6" />
      <circle cx="17" cy="18.5" r="1.6" />
    </Svg>
  ),
  Store: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 9h16v11H4zM3 9l2-5h14l2 5" />
      <path d="M9 20v-6h6v6" />
    </Svg>
  ),
  Factory: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 20V9l5 3V9l5 3V9l5 3v8z" />
      <path d="M3 20h18" />
    </Svg>
  ),
  Crew: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M17 20a5 5 0 0 0-2-4" />
    </Svg>
  ),
  Automation: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </Svg>
  ),
  Bank: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 19v-6h6v6M3 21h18" />
    </Svg>
  ),
  Stocks: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6M20 16v-9" />
    </Svg>
  ),
  Crypto: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8h4a2.5 2.5 0 0 1 0 5h-4V8zM9.5 13h4.5a2.5 2.5 0 0 1 0 5H9.5zM11 6v2M11 18v2" />
    </Svg>
  ),
  Underground: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 5l7 7-7 7M13 5l7 7-7 7" />
    </Svg>
  ),
  Combat: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4l7 7M14 14l6 6M20 4l-6 6M10 14l-6 6" />
    </Svg>
  ),
  Mission: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 9h5M9 13h7M9 17h4" />
    </Svg>
  ),
  Faction: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l8 4v6c0 4-3.4 7.4-8 8-4.6-.6-8-4-8-8V7z" />
    </Svg>
  ),
  News: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 5h13v14H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4" />
    </Svg>
  ),
  Progression: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z" />
    </Svg>
  ),
  Save: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M9 3v6h6V3M9 15h6v6H9z" />
    </Svg>
  ),
  Property: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 11l8-6 8 6v9H4z" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  ),
  Clock: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  Bell: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2 2 0 0 0 4 0" />
    </Svg>
  ),
  Pin: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  ),
  Wallet: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
      <path d="M3 7V6a2 2 0 0 1 2-2h11M16 13h2" />
    </Svg>
  ),
  Scale: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 4v16M6 8h12M4 20h16" />
      <path d="M6 8l-2 5h4zM18 8l-2 5h4z" />
    </Svg>
  ),
  Cube: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </Svg>
  ),
  Arrow: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  Chevron: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 13l5 5L20 6" />
    </Svg>
  ),
  Alert: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  ),
  Info: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </Svg>
  ),
  Search: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </Svg>
  ),
  Lock: (p: IconProps) => (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  Logout: (p: IconProps) => (
    <Svg {...p}>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" />
    </Svg>
  ),
  Refresh: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3M20 4v6h-6" />
    </Svg>
  ),
  Skull: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 11a7 7 0 1 1 14 0v3l-2 2v3H7v-3l-2-2z" />
      <path d="M9 11h.01M15 11h.01M10 18v2M14 18v2" />
    </Svg>
  ),
} as const;

export type IconName = keyof typeof Icon;
