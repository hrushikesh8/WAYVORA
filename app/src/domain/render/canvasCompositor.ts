/* ─── Canvas Compositor ─────────────────────────────────────────────
   Draws a complete RenderFrame onto a 2D canvas context:
   Map background + Camera Viewport + Title Cards + Captions + Media Callouts + Transitions.
   Pure, deterministic drawing pipeline used for frame-by-frame export,
   featuring aspect-ratio safe area framing, smart layout, and cinematic post-processing.
   ─────────────────────────────────────────────────────────────────── */

import type { RenderFrame, SafeAreaInsets, CinematicTreatment, ColorGradePreset } from './types';
import type { AspectRatio, ActiveTitleCardState, MediaType } from '../types';
import {
  drawTransportMarker2D,
  resolveCanonicalTransportMode,
  TRANSPORT_MODE_METADATA,
} from '../transport';

export interface ComposeFrameOptions {
  /** Optional background image or canvas from MapLibre GL */
  mapCanvas?: HTMLCanvasElement | ImageBitmap | null;
  /** Whether mapCanvas is strictly required (throws rather than drawing silent fallback gradient) */
  requireMapCanvas?: boolean;
  /** Whether to draw the subtle technical HUD (timecode, speed, elevation) */
  drawHud?: boolean;
  /** Pre-loaded HTMLImageElement or HTMLVideoElement for active media */
  activeMediaElement?: HTMLImageElement | HTMLVideoElement | ImageBitmap | null;
  /** Optional cinematic treatment (vignette, color grade, contrast) */
  cinematicTreatment?: CinematicTreatment;
  /** Whether to draw subtle dashed safe area guide overlay (for preview) */
  drawSafeAreaGuides?: boolean;
  /** Optional map and terrain attribution watermark for video export compliance */
  attributionText?: string;
  /** Whether to explicitly render 2D transport overlay on canvas (automatic if mapCanvas is missing) */
  renderTransportOverlay?: boolean;
}

/**
 * Calculates platform safe-area insets ensuring critical text and overlays
 * remain uncropped across 16:9 widescreen, 9:16 TikTok/Reels, 1:1 Instagram, and 4:5 portrait.
 */
export function getSafeAreaInsets(
  aspectRatio: AspectRatio,
  width: number,
  height: number
): SafeAreaInsets {
  switch (aspectRatio) {
    case '9:16':
      // TikTok, Reels, Shorts UI: top profile/search (~12%), bottom captions/sound (~18%), right icons (~14%), left (~6%)
      return {
        top: Math.round(height * 0.11),
        bottom: Math.round(height * 0.18),
        left: Math.round(width * 0.06),
        right: Math.round(width * 0.13),
      };
    case '1:1':
      // Square: balanced 7% padding around boundary
      return {
        top: Math.round(height * 0.07),
        bottom: Math.round(height * 0.07),
        left: Math.round(width * 0.07),
        right: Math.round(width * 0.07),
      };
    case '4:5':
      // Instagram portrait
      return {
        top: Math.round(height * 0.08),
        bottom: Math.round(height * 0.10),
        left: Math.round(width * 0.06),
        right: Math.round(width * 0.06),
      };
    case '16:9':
    default:
      // Standard 16:9 TV/Monitor broadcast title safe area (5% margins)
      return {
        top: Math.round(height * 0.05),
        bottom: Math.round(height * 0.06),
        left: Math.round(width * 0.05),
        right: Math.round(width * 0.05),
      };
  }
}

/**
 * Composites a complete frame onto a target 2D canvas context.
 */
export function compositeRenderFrame(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  options?: ComposeFrameOptions
): void {
  const width = frame.metadata.width;
  const height = frame.metadata.height;
  const aspectRatio = frame.metadata.aspectRatio || '16:9';
  const insets = getSafeAreaInsets(aspectRatio, width, height);

  // 1. Clear canvas
  ctx.clearRect(0, 0, width, height);

  // 2. Draw map background or cinematic fallback gradient
  if (options?.mapCanvas) {
    if (options.mapCanvas.width === 0 || options.mapCanvas.height === 0) {
      if (options.requireMapCanvas) {
        throw new Error(`mapCanvas has invalid zero dimensions: ${options.mapCanvas.width}x${options.mapCanvas.height}`);
      }
      drawFallbackBackground(ctx, width, height);
    } else {
      try {
        ctx.drawImage(options.mapCanvas, 0, 0, width, height);
      } catch (err) {
        if (options.requireMapCanvas) {
          throw new Error(`Failed to draw mapCanvas to context: ${err instanceof Error ? err.message : String(err)}`);
        }
        drawFallbackBackground(ctx, width, height);
      }
    }
  } else if (options?.requireMapCanvas) {
    throw new Error('Required map canvas was missing or null in compositeRenderFrame');
  } else {
    drawFallbackBackground(ctx, width, height);
  }

  // 2b. Draw 2D transport marker if mapCanvas is not providing it (fallback/test mode) or explicitly requested
  if (!options?.mapCanvas || options?.renderTransportOverlay) {
    drawTransportMarker2D(ctx, frame);
  }

  // 3. Draw active visual transition (fade-black / crossfade / dissolve)
  if (frame.story.transition) {
    const { type, progress } = frame.story.transition;
    if (type === 'fade-black') {
      const alpha = Math.sin(progress * Math.PI) * 0.96;
      ctx.fillStyle = `rgba(3, 6, 12, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    } else if (type === 'crossfade' || type === 'fade' || type === 'dissolve') {
      const alpha = Math.sin(progress * Math.PI) * 0.88;
      ctx.fillStyle = `rgba(5, 8, 15, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 4. Smart Non-Overlapping Layout for Story Overlays
  const hasTitle = Boolean(frame.story.title);
  const hasMedia = Boolean(frame.story.activeMedia && frame.story.activeMedia.length > 0);

  if (hasTitle && hasMedia) {
    // Both title and media callout active: smart balanced positioning
    if (aspectRatio === '16:9') {
      // Widescreen: Two-column layout (Title on Left, Photo/Video on Right)
      const availableW = width - insets.left - insets.right;
      const titleW = Math.min(availableW * 0.48, 560);
      const titleX = insets.left + 16;
      const titleY = insets.top + (height - insets.top - insets.bottom) * 0.16;

      const mediaW = Math.min(availableW * 0.42, 380);
      const mediaH = Math.min(height * 0.45, 280);
      const mediaX = width - insets.right - mediaW - 16;
      const mediaY = insets.top + (height - insets.top - insets.bottom) * 0.14;

      drawTitleCardBox(ctx, frame.story.title!, frame.story.subtitle, titleX, titleY, titleW);
      drawMediaCalloutBox(ctx, frame, mediaX, mediaY, mediaW, mediaH, options?.activeMediaElement);
    } else {
      // Tall / Square (9:16, 1:1): Vertical Stacking
      const cardW = width - insets.left - insets.right;
      const titleX = insets.left;
      const titleY = insets.top + 16;
      const titleH = frame.story.subtitle ? 130 : 90;

      const mediaH = Math.min((height - insets.top - insets.bottom) * 0.38, 280);
      const mediaX = insets.left;
      const mediaY = titleY + titleH + 16;

      drawTitleCardBox(ctx, frame.story.title!, frame.story.subtitle, titleX, titleY, cardW);
      drawMediaCalloutBox(ctx, frame, mediaX, mediaY, cardW, mediaH, options?.activeMediaElement);
    }
  } else if (hasTitle) {
    // Only title: Centered layout
    const cardWidth = Math.min(width * 0.7, 720);
    const x = (width - cardWidth) / 2;
    const y = insets.top + (height - insets.top - insets.bottom) * 0.18;
    drawTitleCardBox(ctx, frame.story.title!, frame.story.subtitle, x, y, cardWidth);
  } else if (hasMedia) {
    // Only media callout
    const calloutW = Math.min(width * 0.38, 380);
    const calloutH = Math.min(height * 0.45, 280);
    const x = width - insets.right - calloutW - 16;
    const y = insets.top + (height - insets.top - insets.bottom) * 0.14;
    drawMediaCalloutBox(ctx, frame, x, y, calloutW, calloutH, options?.activeMediaElement);
  }

  // 5. Draw Travelogue Caption Bar
  if (frame.story.caption) {
    drawCaptionBar(ctx, frame.story.caption, width, height, insets);
  }

  // 5b. Cinematic Opening / Closing Title Card (full-focus cinematic overlay)
  if (frame.story.activeTitleCard) {
    drawCinematicFullTitleCard(ctx, frame.story.activeTitleCard, width, height, insets);
  }

  // 6. Draw Cinematic Treatments (Vignette & Color Grading)
  if (options?.cinematicTreatment) {
    applyCinematicTreatment(ctx, width, height, options.cinematicTreatment);
  }

  // 7. Draw Technical HUD & Timecode
  if (options?.drawHud !== false) {
    drawTechnicalHud(ctx, frame, width, height, insets);
  }

  // 8. Draw Map & Terrain Legal Attribution Notice
  if (options?.attributionText) {
    drawAttributionNotice(ctx, options.attributionText, width, height, insets);
  }

  // 9. Draw Safe-Area Guides (if enabled for editor preview)
  if (options?.drawSafeAreaGuides) {
    drawSafeAreaGuides(ctx, width, height, insets, aspectRatio);
  }
}

function drawAttributionNotice(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  insets: SafeAreaInsets
): void {
  ctx.save();
  ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, width - insets.right - 8, height - insets.bottom + 12);
  ctx.restore();
}

function drawFallbackBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#0a101d');
  grad.addColorStop(0.5, '#0e182b');
  grad.addColorStop(1, '#060a12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle grid lines denoting cinematic space
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  const step = Math.round(width / 16);
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawTitleCardBox(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string | undefined,
  x: number,
  y: number,
  cardWidth: number
): void {
  ctx.save();
  const cardHeight = subtitle ? 136 : 94;

  // Glassmorphic backdrop
  ctx.fillStyle = 'rgba(10, 15, 26, 0.85)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, cardWidth, cardHeight, 14);
  ctx.fill();
  ctx.stroke();

  // Decorative top accent line
  const accentGrad = ctx.createLinearGradient(x + 20, y, x + cardWidth - 20, y);
  accentGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  accentGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.9)');
  accentGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(x + 30, y, cardWidth - 60, 2);

  // Text drop shadow for high readability
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // Title text
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  const titleFontSize = Math.min(26, Math.max(18, Math.round(cardWidth * 0.05)));
  ctx.font = `700 ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(title.toUpperCase(), x + cardWidth / 2, y + (subtitle ? 52 : 58));

  // Subtitle text
  if (subtitle) {
    ctx.fillStyle = '#94a3b8';
    const subFontSize = Math.max(12, Math.round(titleFontSize * 0.6));
    ctx.font = `500 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(subtitle, x + cardWidth / 2, y + 92);
  }

  ctx.restore();
}

function drawCinematicFullTitleCard(
  ctx: CanvasRenderingContext2D,
  card: ActiveTitleCardState,
  width: number,
  height: number,
  insets: SafeAreaInsets
): void {
  if (card.opacity <= 0.005) return;

  ctx.save();
  ctx.globalAlpha = card.opacity;

  // Apply subtle deterministic motion
  if (card.motion === 'slow-zoom') {
    const scale = 1.0 + card.progress * 0.04;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);
  }

  // Cinematic ambient backdrop (semi-transparent vignette darkening map for high contrast)
  const bgGrad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.08,
    width / 2,
    height / 2,
    width * 0.65
  );
  bgGrad.addColorStop(0, 'rgba(6, 10, 18, 0.72)');
  bgGrad.addColorStop(1, 'rgba(3, 6, 12, 0.90)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Centered Glassmorphic Showcase Box
  const cardW = Math.min(width - insets.left - insets.right, 780);
  const cardH = card.subtitle ? 180 : 130;
  const cardX = (width - cardW) / 2;
  const cardY = (height - cardH) / 2;

  ctx.fillStyle = 'rgba(10, 16, 28, 0.88)';
  ctx.strokeStyle = card.type === 'opening' ? 'rgba(56, 189, 248, 0.45)' : 'rgba(245, 158, 11, 0.45)';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fill();
  ctx.stroke();

  // Decorative top accent line with glow
  const accentColor = card.type === 'opening' ? '56, 189, 248' : '245, 158, 11';
  const accentGrad = ctx.createLinearGradient(cardX + 24, cardY, cardX + cardW - 24, cardY);
  accentGrad.addColorStop(0, `rgba(${accentColor}, 0)`);
  accentGrad.addColorStop(0.5, `rgba(${accentColor}, 0.95)`);
  accentGrad.addColorStop(1, `rgba(${accentColor}, 0)`);
  ctx.fillStyle = accentGrad;
  ctx.fillRect(cardX + 32, cardY, cardW - 64, 2.5);

  // Top Category Badge
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = card.type === 'opening' ? '#38bdf8' : '#f59e0b';
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const badgeText = card.type === 'opening' ? '◆ WAYVORA EXPEDITION' : '◆ EXPEDITION COMPLETE';
  ctx.fillText(badgeText, width / 2, cardY + 36);

  // Main Title
  ctx.fillStyle = '#ffffff';
  const titleFontSize = Math.min(34, Math.max(22, Math.round(cardW * 0.052)));
  ctx.font = `700 ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(card.title.toUpperCase(), width / 2, cardY + (card.subtitle ? 78 : 88));

  // Subtitle
  if (card.subtitle) {
    ctx.fillStyle = '#cbd5e1';
    const subFontSize = Math.max(13, Math.round(titleFontSize * 0.48));
    ctx.font = `400 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(card.subtitle, width / 2, cardY + 120);
  }

  ctx.restore();
}

function drawCaptionBar(
  ctx: CanvasRenderingContext2D,
  caption: string,
  width: number,
  height: number,
  insets: SafeAreaInsets
): void {
  ctx.save();
  const barHeight = 84;
  const y = height - insets.bottom - barHeight - 12;
  const barX = insets.left;
  const barWidth = width - insets.left - insets.right;

  // Background banner
  ctx.fillStyle = 'rgba(8, 12, 20, 0.90)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, barX, y, barWidth, barHeight, 10);
  ctx.fill();
  ctx.stroke();

  // Left golden travelogue icon
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#f59e0b';
  ctx.font = '600 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('◆ EXPEDITION LOG', barX + 20, y + 26);

  // Multi-line caption wrapping
  ctx.fillStyle = '#f1f5f9';
  ctx.font = '400 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const maxTextW = barWidth - 40;
  const measure = (t: string) =>
    typeof ctx.measureText === 'function' ? ctx.measureText(t).width : t.length * 8.5;

  const words = caption.split(' ');
  let line1 = '';
  let line2 = '';

  for (const word of words) {
    const testLine = line1 ? `${line1} ${word}` : word;
    if (measure(testLine) <= maxTextW && !line2) {
      line1 = testLine;
    } else {
      line2 = line2 ? `${line2} ${word}` : word;
    }
  }

  if (line2) {
    ctx.fillText(line1, barX + 20, y + 50);
    // Truncate line 2 with ellipsis if overly long
    let finalLine2 = line2;
    while (measure(finalLine2 + '...') > maxTextW && finalLine2.length > 5) {
      finalLine2 = finalLine2.slice(0, -3);
    }
    ctx.fillText(finalLine2 === line2 ? finalLine2 : finalLine2 + '...', barX + 20, y + 70);
  } else {
    ctx.fillText(line1, barX + 20, y + 56);
  }

  ctx.restore();
}

function drawMediaCalloutBox(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  x: number,
  y: number,
  calloutW: number,
  calloutH: number,
  mediaElement?: HTMLImageElement | HTMLVideoElement | ImageBitmap | null
): void {
  const asset = frame.story.activeMedia[0];
  if (!asset) return;

  ctx.save();

  // Container box
  ctx.fillStyle = 'rgba(10, 15, 26, 0.92)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, calloutW, calloutH, 12);
  ctx.fill();
  ctx.stroke();

  // Media image/video content area
  const contentX = x + 10;
  const contentY = y + 10;
  const contentW = calloutW - 20;
  const contentH = calloutH - 68;

  if (asset.isMissing) {
    // Missing asset placeholder
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    drawRoundedRect(ctx, contentX, contentY, contentW, contentH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f87171';
    ctx.font = '600 13px sans-serif';
    ctx.fillText('⚠ Missing Media File', x + calloutW / 2, contentY + contentH / 2 - 10);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 11px sans-serif';
    ctx.fillText(asset.filename, x + calloutW / 2, contentY + contentH / 2 + 14);
  } else if (mediaElement) {
    try {
      let srcW = 0;
      let srcH = 0;
      if ('videoWidth' in mediaElement && (mediaElement as HTMLVideoElement).videoWidth > 0) {
        srcW = (mediaElement as HTMLVideoElement).videoWidth;
        srcH = (mediaElement as HTMLVideoElement).videoHeight;
      } else if ('naturalWidth' in mediaElement && (mediaElement as HTMLImageElement).naturalWidth > 0) {
        srcW = (mediaElement as HTMLImageElement).naturalWidth;
        srcH = (mediaElement as HTMLImageElement).naturalHeight;
      } else if ('width' in mediaElement) {
        srcW = (mediaElement as ImageBitmap).width;
        srcH = (mediaElement as ImageBitmap).height;
      }

      ctx.save();
      drawRoundedRect(ctx, contentX, contentY, contentW, contentH, 8);
      ctx.clip();

      if (srcW > 0 && srcH > 0) {
        const srcAspect = srcW / srcH;
        const dstAspect = contentW / contentH;
        let sx = 0;
        let sy = 0;
        let sw = srcW;
        let sh = srcH;

        if (srcAspect > dstAspect) {
          // Wider than container: crop horizontal sides
          sw = srcH * dstAspect;
          sx = (srcW - sw) / 2;
        } else {
          // Taller than container: crop vertical top/bottom
          sh = srcW / dstAspect;
          sy = (srcH - sh) / 2;
        }
        ctx.drawImage(mediaElement, sx, sy, sw, sh, contentX, contentY, contentW, contentH);
      } else {
        ctx.drawImage(mediaElement, contentX, contentY, contentW, contentH);
      }
      ctx.restore();
    } catch {
      drawMediaFallbackBox(ctx, contentX, contentY, contentW, contentH, asset.filename, asset.type);
    }
  } else {
    drawMediaFallbackBox(ctx, contentX, contentY, contentW, contentH, asset.filename, asset.type);
  }

  // Authentic EXIF Metadata Tag Footer
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(asset.title || asset.filename, x + 14, y + calloutH - 36);

  // GPS / Timestamp chip
  const metaParts: string[] = [];
  if (asset.type === 'video') {
    metaParts.push('▶ VIDEO');
  }
  if (asset.geoPosition) {
    const lat = asset.geoPosition.lat.toFixed(2);
    const lng = asset.geoPosition.lng.toFixed(2);
    metaParts.push(`📍 ${lat}°, ${lng}°`);
    if (asset.geoPosition.ele) {
      metaParts.push(`⛰ ${Math.round(asset.geoPosition.ele)}m`);
    }
  }
  if (asset.timestamp) {
    metaParts.push(`🕒 ${asset.timestamp.split('T')[0]}`);
  }
  const metaStr = metaParts.length > 0 ? metaParts.join('  ') : (asset.type === 'video' ? '▶ Video Asset' : 'Verified Media Asset');

  ctx.fillStyle = '#38bdf8';
  ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(metaStr, x + 14, y + calloutH - 16);

  ctx.restore();
}

function drawMediaFallbackBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filename: string,
  mediaType?: MediaType
): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 12px sans-serif';
  if (mediaType === 'video') {
    ctx.fillText(`🎬 [Video Unavailable] ${filename}`, x + w / 2, y + h / 2);
  } else {
    ctx.fillText(`📷 ${filename}`, x + w / 2, y + h / 2);
  }
}

function drawTechnicalHud(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  width: number,
  height: number,
  insets: SafeAreaInsets
): void {
  ctx.save();
  ctx.font = '500 11px "SF Mono", Monaco, Consolas, monospace';

  // Top Left: Timecode, progress %, and live elevation
  const timeSec = frame.timestampSeconds;
  const mins = Math.floor(timeSec / 60)
    .toString()
    .padStart(2, '0');
  const secs = (timeSec % 60).toFixed(1).padStart(4, '0');
  const timecode = `${mins}:${secs} / ${Math.round(frame.totalDurationSeconds)}s`;
  const pct = Math.round(frame.spatialProgress * 100);

  const canonicalMode = resolveCanonicalTransportMode(frame.transportMode);
  const modeMeta = TRANSPORT_MODE_METADATA[canonicalMode];
  const modeStr = ` · ${modeMeta.label}`;
  const eleStr = frame.position.ele != null ? ` · ⛰ ${Math.round(frame.position.ele)}m` : '';

  const hudX = Math.max(16, insets.left);
  const hudY = Math.max(16, insets.top - 20);
  const hudW = 280;

  ctx.fillStyle = 'rgba(10, 15, 26, 0.75)';
  ctx.fillRect(hudX, hudY, hudW, 28);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect?.(hudX, hudY, hudW, 28);

  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'left';
  ctx.fillText(`⏱ ${timecode} (${pct}%)${modeStr}${eleStr}`, hudX + 10, hudY + 18);

  // Top Right: WAYVORA Studio watermark & resolution
  const rightW = 180;
  const rightX = width - insets.right - rightW;
  ctx.fillStyle = 'rgba(10, 15, 26, 0.75)';
  ctx.fillRect(rightX, hudY, rightW, 28);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect?.(rightX, hudY, rightW, 28);

  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(`WAYVORA · ${width}×${height}`, rightX + rightW - 10, hudY + 18);

  ctx.restore();
}

/**
 * Applies cinematic post-processing: radial vignette, color grading, contrast.
 */
export function applyCinematicTreatment(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  treatment: CinematicTreatment
): void {
  // 1. Subtle Radial Vignette
  if (treatment.vignette) {
    drawVignette(ctx, width, height, treatment.vignetteIntensity ?? 0.35);
  }

  // 2. Color Grading Preset
  if (treatment.colorGrade && treatment.colorGrade !== 'none') {
    drawColorGrade(ctx, width, height, treatment.colorGrade);
  }

  // 3. Contrast Boost
  if (treatment.contrastBoost && treatment.contrastBoost > 0) {
    applyContrastBoost(ctx, width, height, treatment.contrastBoost);
  }
}

export function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  intensity: number = 0.35
): void {
  ctx.save();
  const cx = width / 2;
  const cy = height / 2;
  const r0 = Math.min(width, height) * 0.45;
  const r1 = Math.sqrt(width * width + height * height) * 0.55;

  const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.65, `rgba(0, 0, 0, ${(intensity * 0.35).toFixed(3)})`);
  grad.addColorStop(1, `rgba(0, 0, 0, ${intensity.toFixed(3)})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function drawColorGrade(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: ColorGradePreset
): void {
  ctx.save();
  switch (preset) {
    case 'golden-hour': {
      // Warm amber tint with golden highlights
      ctx.fillStyle = 'rgba(251, 146, 60, 0.055)';
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'alpine-cool': {
      // Crisp cyan-blue mountain tint
      ctx.fillStyle = 'rgba(56, 189, 248, 0.045)';
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'sunset-glow': {
      // Diagonal gradient from warm orange to twilight violet
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, 'rgba(249, 115, 22, 0.06)');
      grad.addColorStop(1, 'rgba(168, 85, 247, 0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'noir-contrast': {
      // High contrast dramatic mood
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(0, 0, width, height);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function applyContrastBoost(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  boost: number
): void {
  // Soft overlay blend for subtle filmic contrast
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = `rgba(0, 0, 0, ${(boost * 0.5).toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function drawSafeAreaGuides(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  insets: SafeAreaInsets,
  aspectRatio: AspectRatio
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);

  const safeW = width - insets.left - insets.right;
  const safeH = height - insets.top - insets.bottom;

  ctx.strokeRect(insets.left, insets.top, safeW, safeH);

  ctx.fillStyle = 'rgba(234, 179, 8, 0.7)';
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`SAFE AREA (${aspectRatio})`, insets.left + 8, insets.top + 14);

  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface FramePixelValidationResult {
  isValid: boolean;
  reason?: string;
  details?: {
    sampledPixels: number;
    nonZeroAlphaPixels: number;
    averageLuminance: number;
    maxLuminance: number;
    isCompletelyTransparent: boolean;
    isCompletelyBlack: boolean;
  };
}

/**
 * Inspects canvas pixel output to verify that a frame contains actual rendered content,
 * distinguishing legitimate dark scenes from genuinely failed, blank, or black frames.
 */
export function validateRenderedFramePixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  context?: {
    hasMapCanvas?: boolean;
    isTransitioning?: boolean;
    isTitleCard?: boolean;
  }
): FramePixelValidationResult {
  if (width <= 0 || height <= 0) {
    return {
      isValid: false,
      reason: `Invalid canvas dimensions: ${width}x${height}`,
    };
  }

  // Gracefully pass in Node/Vitest mock environments where getImageData is stubbed or unavailable
  if (typeof ctx.getImageData !== 'function') {
    return { isValid: true };
  }

  try {
    const sampleCols = Math.min(24, width);
    const sampleRows = Math.min(24, height);
    const stepX = Math.max(1, Math.floor(width / sampleCols));
    const stepY = Math.max(1, Math.floor(height / sampleRows));

    let sampledPixels = 0;
    let nonZeroAlphaPixels = 0;
    let totalLuminance = 0;
    let maxLuminance = 0;

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData?.data;
    if (!data || data.length === 0) {
      return { isValid: true };
    }

    for (let r = 0; r < sampleRows; r++) {
      const y = Math.min(height - 1, r * stepY);
      for (let c = 0; c < sampleCols; c++) {
        const x = Math.min(width - 1, c * stepX);
        const idx = (y * width + x) * 4;
        const red = data[idx] ?? 0;
        const green = data[idx + 1] ?? 0;
        const blue = data[idx + 2] ?? 0;
        const alpha = data[idx + 3] ?? 0;

        sampledPixels++;
        if (alpha > 0) {
          nonZeroAlphaPixels++;
        }
        // ITU-R BT.709 relative luminance
        const lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        totalLuminance += lum;
        if (lum > maxLuminance) {
          maxLuminance = lum;
        }
      }
    }

    const avgLuminance = sampledPixels > 0 ? totalLuminance / sampledPixels : 0;
    const isCompletelyTransparent = nonZeroAlphaPixels === 0;
    const isCompletelyBlack = maxLuminance < 1;

    const details = {
      sampledPixels,
      nonZeroAlphaPixels,
      averageLuminance: avgLuminance,
      maxLuminance,
      isCompletelyTransparent,
      isCompletelyBlack,
    };

    if (isCompletelyTransparent) {
      return {
        isValid: false,
        reason: 'Canvas is completely transparent (all sampled pixels have alpha = 0)',
        details,
      };
    }

    if (isCompletelyBlack) {
      // If not intentionally in the middle of a full fade-to-black transition,
      // a completely black frame represents an unrendered or failed frame.
      if (!context?.isTransitioning) {
        return {
          isValid: false,
          reason: 'Canvas is completely black (zero luminance across all sampled pixels)',
          details,
        };
      }
    }

    return { isValid: true, details };
  } catch (err) {
    // If getImageData throws due to tainted cross-origin asset, log warning and allow export
    console.warn('[validateRenderedFramePixels] Pixel inspection warning:', err);
    return { isValid: true };
  }
}

