import { Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * UzBite's own line icons (same drawings as the website, apps/frontend/src/components/icons/Icon.tsx):
 * viewBox 0 0 24 24, 1.7 stroke, round caps, colour from the `color` prop. No icon libraries, no emoji.
 */
const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  orders: 'M7 4h10l3 4v13H4V8zM4 8h16M9 12h6m-6 4h4M9 4V2m6 2V2',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 7 0 0 1 16 0v2',
  restaurant: 'M4 10v11h16V10M3 10l2-7h14l2 7M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2M9 21v-6h6v6',
  location: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15',
  bicycle: 'M9 5h4m-2 0 4 12M5 17l6-9h6l3 9M5 17h10M17 5h3l1 3M9 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0M23 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3a7 7 0 0 0 11.6-2',
  card: 'M3 5h18v14H3zM3 10h18M7 15h4',
  cash: 'M2 6h20v12H2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M5 10v4m14-4v4',
  receipt: 'M5 3h14v19l-3-2-4 2-4-2-3 2zM9 7h6m-6 4h6m-6 4h3',
  delivery: 'M2 5h12v13H2zM14 10h4l4 5v3h-8M8 18a2 2 0 1 1-4 0m16 0a2 2 0 1 1-4 0',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  notifications: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4M12 4V2',
  edit: 'm15 4 5 5M4 15 16 3l5 5L9 20l-6 1z',
  back: 'm14 5-7 7 7 7', arrow: 'M4 12h16m-6-6 6 6-6 6', chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  close: 'm5 5 14 14M5 19 19 5', check: 'm4 12 5 5L20 6', plus: 'M12 4v16M4 12h16',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',
  logout: 'M9 3H3v18h6M9 12h12m-5-5 5 5-5 5',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.58 2.79.7A2 2 0 0 1 22 16.92z',
  telegram: 'm21 3-7 18-4-7-7-4zM10 14 21 3',
  shield: 'm12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6',
  wifiOff: 'm3 3 18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.5 5M12 20h.01',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4 2 4M16 13.5h2',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7m1.5 0h.01',
  alert: 'M12 3 2 20h20zM12 9v5m0 3h.01',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
} as const;
export type IconName = keyof typeof paths | 'help';
/** Icons are decorative (buttons carry the label). The web build has no such native props. */
const hiddenFromScreenReaders = Platform.OS === 'web' ? { 'aria-hidden': true } : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

export function Icon({ name, size = 22, color, strokeWidth = 1.7 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...hiddenFromScreenReaders}>
      {name === 'help'
        ? <><Circle cx={12} cy={12} r={9} /><Path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 1.75-2.5 2-2.5 4" /><Circle cx={12} cy={16.5} r={0.8} fill={color} stroke="none" /></>
        : <Path d={paths[name]} />}
    </Svg>
  );
}
