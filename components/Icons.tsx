// Small stroke icons, 20px grid, inherit currentColor.
type P = { size?: number; className?: string };

function Svg({ size = 18, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const LogoMark = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
    <path d="M12 6.6a3.9 3.9 0 0 1 3.9 3.9c0 2.9-3.9 6.9-3.9 6.9s-3.9-4-3.9-6.9A3.9 3.9 0 0 1 12 6.6z" fill="var(--accent)" />
    <circle cx="12" cy="10.5" r="1.45" fill="var(--sheet)" />
  </svg>
);

export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M10 13V3M6 7l4-4 4 4M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5l4 4 8-9" />
  </Svg>
);
export const IconOpen = (p: P) => (
  <Svg {...p}>
    <path d="M11 3h6v6M17 3l-8 8M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 5.5h13M8 5.5V4h4v1.5M5 5.5l.8 10.6A1.5 1.5 0 0 0 7.3 17.5h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5" />
  </Svg>
);
export const IconKey = (p: P) => (
  <Svg {...p}>
    <circle cx="6.5" cy="13.5" r="3.5" />
    <path d="M9 11l7.5-7.5M14 6l2 2M12 8l1.5 1.5" />
  </Svg>
);
export const IconImages = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2" />
    <circle cx="7" cy="8.5" r="1.4" />
    <path d="M17.5 13l-4-4-7 7" />
  </Svg>
);
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.7-6 8-3.4-1.3-6-4-6-8V5z" />
    <path d="M7.5 10l2 2 3.5-4" />
  </Svg>
);
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 8l4.5 4.5L14.5 8" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 5.5V10l3 2" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Svg>
);
