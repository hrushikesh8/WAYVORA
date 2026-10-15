/* ─── Transport SVG Silhouettes & Icon Generators ────────────────────────
   Clean, modern, high-contrast SVG vector silhouettes for all 8 transport modes:
   Car, Bus, Train, Hiker, Motorcycle, Bicycle, Boat, and Airplane.

   All silhouettes are standardized on a 64x64 viewport, centered at (32, 32),
   and oriented facing NORTH (0° heading / UP along negative Y-axis).
   ─────────────────────────────────────────────────────────────────── */

import type { CanonicalTransportMode } from './types';
import { TRANSPORT_MODE_METADATA } from './types';

/**
 * Generates raw SVG markup for a given transport mode.
 * Standardized on 64x64 viewport, facing 0° (North/Up).
 */
export function getTransportSvg(
  mode: CanonicalTransportMode,
  options?: {
    color?: string;
    haloColor?: string;
    size?: number;
  }
): string {
  const meta = TRANSPORT_MODE_METADATA[mode] || TRANSPORT_MODE_METADATA.car;
  const accent = options?.color || meta.accentColor;
  const halo = options?.haloColor || '#050b14';
  const size = options?.size || 64;

  let paths = '';

  switch (mode) {
    case 'car':
      paths = `
        <!-- Car Outer Body Shadow/Halo -->
        <path d="M22 10 C22 8, 42 8, 42 10 L44 19 L46 25 L46 48 C46 52, 44 54, 41 54 L23 54 C20 54, 18 52, 18 48 L18 25 L20 19 Z" fill="${halo}" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round"/>
        <!-- Side Mirrors -->
        <path d="M16 23 C14 23, 14 27, 17 28 Z M48 23 C50 23, 50 27, 47 28 Z" fill="${accent}"/>
        <!-- Windshield -->
        <path d="M22 21 L42 21 L40 29 L24 29 Z" fill="${accent}" opacity="0.9"/>
        <!-- Roof -->
        <rect x="23" y="30" width="18" height="12" rx="2" fill="${halo}" stroke="${accent}" stroke-width="1.5"/>
        <!-- Rear Window -->
        <path d="M24 43 L40 43 L41 48 L23 48 Z" fill="${accent}" opacity="0.75"/>
        <!-- Headlights -->
        <circle cx="23" cy="11" r="2" fill="#ffffff"/>
        <circle cx="41" cy="11" r="2" fill="#ffffff"/>
      `;
      break;

    case 'bus':
      paths = `
        <!-- Bus Body -->
        <rect x="18" y="8" width="28" height="48" rx="6" fill="${halo}" stroke="${accent}" stroke-width="2.5"/>
        <!-- Front Windshield -->
        <path d="M21 12 C21 10, 43 10, 43 12 L43 18 L21 18 Z" fill="${accent}" opacity="0.9"/>
        <!-- Side Windows (Left & Right) -->
        <rect x="20" y="21" width="3" height="26" rx="1" fill="${accent}" opacity="0.8"/>
        <rect x="41" y="21" width="3" height="26" rx="1" fill="${accent}" opacity="0.8"/>
        <!-- Roof Center Spine / Vents -->
        <rect x="27" y="22" width="10" height="24" rx="2" fill="${halo}" stroke="${accent}" stroke-width="1.2"/>
        <!-- Headlights & Mirror Accents -->
        <circle cx="21" cy="9" r="1.8" fill="#ffffff"/>
        <circle cx="43" cy="9" r="1.8" fill="#ffffff"/>
      `;
      break;

    case 'train':
      paths = `
        <!-- Train Aerodynamic Silhouette -->
        <path d="M32 6 C26 6, 20 14, 20 22 L20 54 C20 57, 23 58, 26 58 L38 58 C41 58, 44 57, 44 54 L44 22 C44 14, 38 6, 32 6 Z" fill="${halo}" stroke="${accent}" stroke-width="2.5"/>
        <!-- Cab Windshield -->
        <path d="M24 18 C28 14, 36 14, 40 18 L38 24 L26 24 Z" fill="${accent}" opacity="0.95"/>
        <!-- Nose Light -->
        <circle cx="32" cy="10" r="2.2" fill="#ffffff"/>
        <!-- Center Roof Line -->
        <line x1="32" y1="26" x2="32" y2="48" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
        <!-- Pantograph Ridge -->
        <rect x="25" y="48" width="14" height="6" rx="1.5" fill="${accent}" opacity="0.85"/>
      `;
      break;

    case 'hiker':
      paths = `
        <!-- Trekking Poles -->
        <line x1="15" y1="14" x2="25" y2="34" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
        <line x1="49" y1="14" x2="39" y2="34" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
        <circle cx="15" cy="14" r="2" fill="#ffffff"/>
        <circle cx="49" cy="14" r="2" fill="#ffffff"/>
        <!-- Backpack & Body -->
        <rect x="23" y="24" width="18" height="22" rx="5" fill="${halo}" stroke="${accent}" stroke-width="2.2"/>
        <rect x="25" y="27" width="14" height="16" rx="3" fill="${accent}" opacity="0.35"/>
        <!-- Shoulders -->
        <path d="M21 28 Q32 24 43 28" stroke="${accent}" stroke-width="3" stroke-linecap="round" fill="none"/>
        <!-- Hiker Hat / Head (Center) -->
        <circle cx="32" cy="22" r="7" fill="${halo}" stroke="${accent}" stroke-width="2"/>
        <circle cx="32" cy="22" r="4.5" fill="${accent}"/>
      `;
      break;

    case 'motorcycle':
      paths = `
        <!-- Front Tire -->
        <rect x="30" y="6" width="4" height="14" rx="2" fill="${accent}"/>
        <!-- Handlebars -->
        <path d="M16 18 Q32 16 48 18" stroke="${accent}" stroke-width="3" stroke-linecap="round" fill="none"/>
        <circle cx="16" cy="18" r="2" fill="#ffffff"/>
        <circle cx="48" cy="18" r="2" fill="#ffffff"/>
        <!-- Headlight -->
        <circle cx="32" cy="14" r="2.5" fill="#ffffff"/>
        <!-- Fuel Tank & Chassis -->
        <ellipse cx="32" cy="27" rx="6" ry="8" fill="${halo}" stroke="${accent}" stroke-width="2"/>
        <!-- Rider Shoulders & Helmet -->
        <ellipse cx="32" cy="33" rx="10" ry="4" fill="${accent}" opacity="0.6"/>
        <circle cx="32" cy="33" r="4.5" fill="${halo}" stroke="${accent}" stroke-width="1.8"/>
        <!-- Rear Tire & Exhaust -->
        <rect x="30" y="44" width="4" height="14" rx="2" fill="${accent}"/>
      `;
      break;

    case 'bicycle':
      paths = `
        <!-- Front Wheel -->
        <rect x="30.5" y="6" width="3" height="15" rx="1.5" fill="${accent}"/>
        <!-- Handlebars -->
        <path d="M20 20 Q32 18 44 20" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <!-- Frame Main Spine -->
        <line x1="32" y1="20" x2="32" y2="44" stroke="${accent}" stroke-width="2.5"/>
        <!-- Cyclist Shoulders & Helmet -->
        <ellipse cx="32" cy="28" rx="8" ry="4" fill="${halo}" stroke="${accent}" stroke-width="1.5"/>
        <circle cx="32" cy="28" r="3.5" fill="${accent}"/>
        <!-- Pedals / Cranks -->
        <line x1="24" y1="36" x2="40" y2="36" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
        <!-- Saddle -->
        <path d="M29 39 L35 39 L32 44 Z" fill="${accent}"/>
        <!-- Rear Wheel -->
        <rect x="30.5" y="44" width="3" height="14" rx="1.5" fill="${accent}"/>
      `;
      break;

    case 'boat':
      paths = `
        <!-- Boat Hull (Sharp V-Bow, Transom Stern) -->
        <path d="M32 6 C28 14, 18 28, 18 48 L18 56 L46 56 L46 48 C46 28, 36 14, 32 6 Z" fill="${halo}" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round"/>
        <!-- Deck Outline -->
        <path d="M32 14 C29 20, 22 30, 22 46 L42 46 C42 30, 35 20, 32 14 Z" fill="${accent}" opacity="0.25"/>
        <!-- Cockpit Windshield -->
        <path d="M24 30 Q32 26 40 30 L39 36 Q32 33 25 36 Z" fill="${accent}" opacity="0.95"/>
        <!-- Captain Console -->
        <circle cx="32" cy="38" r="3" fill="${halo}" stroke="${accent}" stroke-width="1.5"/>
        <!-- Outboard Motor / Stern Transom -->
        <rect x="29" y="54" width="6" height="5" rx="1" fill="${accent}"/>
      `;
      break;

    case 'airplane':
      paths = `
        <!-- Airplane Fuselage & Swept Wings -->
        <path d="M32 6 C30 14, 30 24, 28 26 L6 38 L6 42 L28 35 L28 48 L22 53 L22 56 L32 54 L42 56 L42 53 L36 48 L36 35 L58 42 L58 38 L36 26 C34 24, 34 14, 32 6 Z" fill="${halo}" stroke="${accent}" stroke-width="2.2" stroke-linejoin="round"/>
        <!-- Cockpit Windows -->
        <path d="M30 13 L34 13 L33 16 L31 16 Z" fill="#ffffff"/>
        <!-- Twin Jet Turbofans -->
        <rect x="18" y="32" width="3.5" height="7" rx="1.5" fill="${accent}"/>
        <rect x="42.5" y="32" width="3.5" height="7" rx="1.5" fill="${accent}"/>
      `;
      break;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
      ${paths}
    </svg>
  `.trim();
}

/**
 * Returns a self-contained data URL for a transport SVG icon.
 */
export function getTransportSvgDataUrl(
  mode: CanonicalTransportMode,
  options?: { color?: string; haloColor?: string; size?: number }
): string {
  const svg = getTransportSvg(mode, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Creates an HTMLImageElement from the transport SVG icon for MapLibre or Canvas drawing.
 */
export function loadTransportSvgImage(
  mode: CanonicalTransportMode,
  options?: { color?: string; haloColor?: string; size?: number }
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      return reject(new Error('Window or Image constructor is not available'));
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = getTransportSvgDataUrl(mode, options);
  });
}
