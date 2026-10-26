/* ─── WAYVORA Brand Logo & App Identity ────────────────────────────────
   Official brand component integrating the approved WAYVORA identity assets
   from wayvora-selected-assets:
   - wayvora-icon.png / wayvora-icon.svg (Approved standalone icon)
   - wayvora-wordmark.png (Cleanly extracted wordmark artwork from brand board)
   ─────────────────────────────────────────────────────────────────── */

import React from 'react';
import wayvoraIcon from '../assets/wayvora-icon.png';
import wayvoraWordmark from '../assets/wayvora-wordmark.png';

export type LogoVariant = 'primary' | 'compact' | 'symbol' | 'monochrome' | 'lockup';

export interface WayvoraLogoProps {
  /** Visual presentation variant */
  variant?: LogoVariant;
  /** Size in pixels or preset size */
  size?: number | 'sm' | 'md' | 'lg';
  /** Whether to display the tagline 'From Roads to Trails, Every Journey Becomes a Story.' */
  showTagline?: boolean;
  /** Whether to display the 'STUDIO V1' version pill */
  showVersion?: boolean;
  /** Custom wrapper CSS class */
  className?: string;
  /** Optional click handler (e.g. to reset or scroll to top) */
  onClick?: () => void;
  /** Custom accessible label */
  ariaLabel?: string;
}

const SIZE_PRESETS = {
  sm: 24,
  md: 30,
  lg: 40,
};

export const WayvoraLogo: React.FC<WayvoraLogoProps> = ({
  variant = 'primary',
  size = 'md',
  showTagline = false,
  showVersion = false,
  className = '',
  onClick,
  ariaLabel = 'WAYVORA — From Roads to Trails, Every Journey Becomes a Story',
}) => {
  const pixelSize = typeof size === 'number' ? size : SIZE_PRESETS[size] || 30;
  const isCompact = variant === 'compact';
  const isMonochrome = variant === 'monochrome';

  // Render the approved standalone icon asset
  const renderSymbol = () => {
    return (
      <img
        src={wayvoraIcon}
        alt="WAYVORA Icon"
        width={pixelSize}
        height={pixelSize}
        className={`wayvora-logo-symbol ${isMonochrome ? 'wayvora-logo-mono' : 'wayvora-logo-badge'}`}
        style={{
          width: `${pixelSize}px`,
          height: `${pixelSize}px`,
          objectFit: 'contain',
          borderRadius: '22%',
          display: 'block',
          flexShrink: 0,
          filter: isMonochrome ? 'grayscale(1) contrast(1.2)' : undefined,
        }}
      />
    );
  };

  return (
    <div
      className={`wayvora-logo-lockup ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : 'img'}
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="wayvora-logo-badge-wrap" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {renderSymbol()}
      </div>

      {!isCompact && (
        <div className="wayvora-logo-text-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src={wayvoraWordmark}
              alt="WAYVORA"
              className="brand-title-img"
              style={{
                height: pixelSize >= 36 ? '18px' : '15px',
                width: 'auto',
                objectFit: 'contain',
                display: 'block',
              }}
            />
            {showVersion && <span className="tag-version">STUDIO V1</span>}
          </div>
          {(showTagline || variant === 'lockup') && (
            <span
              className="wayvora-tagline"
              style={{
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: '8.5px',
                fontWeight: 600,
                letterSpacing: '1.2px',
                color: '#ff8a00',
                marginTop: '3px',
                textTransform: 'uppercase',
                opacity: 0.9,
              }}
            >
              From Roads to Trails, Every Journey Becomes a Story.
            </span>
          )}
        </div>
      )}
    </div>
  );
};
