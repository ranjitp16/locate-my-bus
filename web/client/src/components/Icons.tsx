import type { CSSProperties, ReactNode } from 'react';

export type IconProps = {
  size?: number;
  stroke?: number;
  style?: CSSProperties;
};

function Ic({ size = 20, stroke = 1.75, children, style }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {children}
    </svg>
  );
}

export const IconBus = (p: IconProps) => (
  <Ic {...p}>
    <rect x="4" y="3" width="16" height="15" rx="2" />
    <path d="M4 11h16" />
    <path d="M8 18v2M16 18v2" />
    <circle cx="8" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M7 6h10" />
  </Ic>
);

export const IconPin = (p: IconProps) => (
  <Ic {...p}>
    <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z" />
    <circle cx="12" cy="9" r="2.5" />
  </Ic>
);

export const IconLocation = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Ic>
);

export const IconLayers = (p: IconProps) => (
  <Ic {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5Z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </Ic>
);

export const IconRoute = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="19" r="2" />
    <path d="M6 7c0 5 6 4 6 8s6 4 6 4M6 7v4M18 13v4" />
  </Ic>
);

export const IconSearch = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Ic>
);

export const IconClose = (p: IconProps) => (
  <Ic {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Ic>
);

export const IconChevron = (p: IconProps) => (
  <Ic {...p}>
    <path d="m9 6 6 6-6 6" />
  </Ic>
);

export const IconArrowLeft = (p: IconProps) => (
  <Ic {...p}>
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </Ic>
);

export const IconArrowRight = (p: IconProps) => (
  <Ic {...p}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Ic>
);

export const IconSwap = (p: IconProps) => (
  <Ic {...p}>
    <path d="M7 4v15M3 8l4-4 4 4" />
    <path d="M17 20V5M21 16l-4 4-4-4" />
  </Ic>
);

export const IconWalk = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="13" cy="4" r="2" />
    <path d="m9 21 3-7 3 3 3 1" />
    <path d="M12 14 7 17l-1 4" />
    <path d="m13 7-4 3 2 4" />
  </Ic>
);

export const IconClock = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Ic>
);

export const IconPlus = (p: IconProps) => (
  <Ic {...p}>
    <path d="M12 5v14M5 12h14" />
  </Ic>
);

export const IconTrash = (p: IconProps) => (
  <Ic {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Ic>
);

export const IconExternal = (p: IconProps) => (
  <Ic {...p}>
    <path d="M14 4h6v6M10 14l10-10M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
  </Ic>
);

export const IconActivity = (p: IconProps) => (
  <Ic {...p}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Ic>
);

export const IconBolt = (p: IconProps) => (
  <Ic {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Ic>
);

export const IconChart = (p: IconProps) => (
  <Ic {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 14V9M12 17V5M17 17v-7" />
  </Ic>
);

export const IconRefresh = (p: IconProps) => (
  <Ic {...p}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </Ic>
);

export const IconMenu = (p: IconProps) => (
  <Ic {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Ic>
);

export const IconGear = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Ic>
);

export const IconRadio = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49" />
    <path d="M20.49 4a10 10 0 0 1 0 16M3.51 20a10 10 0 0 1 0-16" />
  </Ic>
);

export const IconCheck = (p: IconProps) => (
  <Ic {...p}>
    <path d="M4 12l5 5L20 6" />
  </Ic>
);

export const IconFlag = (p: IconProps) => (
  <Ic {...p}>
    <path d="M4 21V4h12l-2 5 2 5H4" />
  </Ic>
);

export const IconHome = (p: IconProps) => (
  <Ic {...p}>
    <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V11Z" />
  </Ic>
);
