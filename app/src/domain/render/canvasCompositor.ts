/* ─── Canvas Compositor ─────────────────────────────────────────────
   Draws a complete RenderFrame onto a 2D canvas context:
   Map background + Camera Viewport + Title Cards + Captions + Media Callouts + Transitions.
   Pure, deterministic drawing pipeline used for frame-by-frame export.
   ─────────────────────────────────────────────────────────────────── */

import type { RenderFrame } from './types';

export interface ComposeFrameOptions {
  /** Optional background image or canvas from MapLibre GL */
  mapCanvas?: HTMLCanvasElement | ImageBitmap | null;
  /** Whether to draw the subtle technical HUD (timecode, speed, elevation) */
  drawHud?: boolean;
  /** Pre-loaded HTMLImageElement or HTMLVideoElement for active media */
  activeMediaElement?: HTMLImageElement | HTMLVideoElement | ImageBitmap | null;
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

  // 1. Clear canvas
  ctx.clearRect(0, 0, width, height);

  // 2. Draw map background or cinematic fallback gradient
  if (options?.mapCanvas) {
    try {
      ctx.drawImage(options.mapCanvas, 0, 0, width, height);
    } catch {
      drawFallbackBackground(ctx, width, height);
    }
  } else {
    drawFallbackBackground(ctx, width, height);
  }

  // 3. Draw active visual transition (fade/dissolve)
  if (frame.story.transition) {
    const { type, progress } = frame.story.transition;
    if (type === 'fade' || type === 'dissolve') {
      // Fade in / out black veil
      const alpha = Math.sin(progress * Math.PI) * 0.85;
      ctx.fillStyle = `rgba(5, 8, 15, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 4. Draw Floating Media Callout (Photos / Videos)
  if (frame.story.activeMedia && frame.story.activeMedia.length > 0) {
    drawMediaCallout(ctx, frame, width, height, options?.activeMediaElement);
  }

  // 5. Draw Cinematic Title Card
  if (frame.story.title) {
    drawTitleCard(ctx, frame.story.title, frame.story.subtitle, width, height);
  }

  // 6. Draw Travelogue Caption Bar
  if (frame.story.caption) {
    drawCaptionBar(ctx, frame.story.caption, width, height);
  }

  // 7. Draw Technical HUD & Timecode
  if (options?.drawHud !== false) {
    drawTechnicalHud(ctx, frame, width, height);
  }
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

  // Subtle grid lines to denote cinematic space
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

function drawTitleCard(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string | undefined,
  width: number,
  height: number
): void {
  ctx.save();
  const cardWidth = Math.min(width * 0.7, 720);
  const cardHeight = subtitle ? 140 : 100;
  const x = (width - cardWidth) / 2;
  const y = height * 0.22;

  // Glassmorphic backdrop
  ctx.fillStyle = 'rgba(10, 15, 26, 0.82)';
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
  ctx.fillRect(x + 40, y, cardWidth - 80, 2);

  // Title text
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(title.toUpperCase(), width / 2, y + (subtitle ? 55 : 62));

  // Subtitle text
  if (subtitle) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(subtitle, width / 2, y + 95);
  }

  ctx.restore();
}

function drawCaptionBar(
  ctx: CanvasRenderingContext2D,
  caption: string,
  width: number,
  height: number
): void {
  ctx.save();
  const barHeight = 84;
  const y = height - barHeight - 40;
  const margin = Math.min(width * 0.08, 100);
  const barWidth = width - margin * 2;

  // Background banner
  ctx.fillStyle = 'rgba(8, 12, 20, 0.88)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, margin, y, barWidth, barHeight, 10);
  ctx.fill();
  ctx.stroke();

  // Left golden travelogue icon
  ctx.fillStyle = '#f59e0b';
  ctx.font = '600 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('◆ EXPEDITION LOG', margin + 24, y + 28);

  // Caption body
  ctx.fillStyle = '#f1f5f9';
  ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(caption, margin + 24, y + 58);

  ctx.restore();
}

function drawMediaCallout(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  width: number,
  height: number,
  mediaElement?: HTMLImageElement | HTMLVideoElement | ImageBitmap | null
): void {
  const asset = frame.story.activeMedia[0];
  if (!asset) return;

  ctx.save();
  const calloutW = Math.min(width * 0.38, 380);
  const calloutH = Math.min(height * 0.45, 280);
  const x = width - calloutW - 40;
  const y = height * 0.18;

  // Container box
  ctx.fillStyle = 'rgba(10, 15, 26, 0.9)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, calloutW, calloutH, 12);
  ctx.fill();
  ctx.stroke();

  // Media image/video content area
  const contentX = x + 12;
  const contentY = y + 12;
  const contentW = calloutW - 24;
  const contentH = calloutH - 74;

  if (asset.isMissing) {
    // Missing asset placeholder
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    drawRoundedRect(ctx, contentX, contentY, contentW, contentH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f87171';
    ctx.font = '600 14px sans-serif';
    ctx.fillText('⚠ Missing Media File', x + calloutW / 2, contentY + contentH / 2 - 10);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 12px sans-serif';
    ctx.fillText(asset.filename, x + calloutW / 2, contentY + contentH / 2 + 15);
  } else if (mediaElement) {
    try {
      ctx.save();
      // Clip to rounded media area
      drawRoundedRect(ctx, contentX, contentY, contentW, contentH, 8);
      ctx.clip();
      ctx.drawImage(mediaElement, contentX, contentY, contentW, contentH);
      ctx.restore();
    } catch {
      drawMediaFallbackBox(ctx, contentX, contentY, contentW, contentH, asset.filename);
    }
  } else {
    drawMediaFallbackBox(ctx, contentX, contentY, contentW, contentH, asset.filename);
  }

  // Authentic EXIF Metadata Tag Footer
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(asset.title || asset.filename, x + 16, y + calloutH - 40);

  // GPS / Timestamp chip
  const metaParts: string[] = [];
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
  const metaStr = metaParts.length > 0 ? metaParts.join('  ') : 'Verified Media Asset';

  ctx.fillStyle = '#38bdf8';
  ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(metaStr, x + 16, y + calloutH - 18);

  ctx.restore();
}

function drawMediaFallbackBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filename: string
): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 13px sans-serif';
  ctx.fillText(`📷 ${filename}`, x + w / 2, y + h / 2);
}

function drawTechnicalHud(
  ctx: CanvasRenderingContext2D,
  frame: RenderFrame,
  width: number,
  height: number
): void {
  ctx.save();
  ctx.font = '500 12px "SF Mono", Monaco, Consolas, monospace';

  // Top Left: Timecode and progress
  const timeSec = frame.timestampSeconds;
  const mins = Math.floor(timeSec / 60)
    .toString()
    .padStart(2, '0');
  const secs = (timeSec % 60).toFixed(1).padStart(4, '0');
  const timecode = `${mins}:${secs} / ${Math.round(frame.totalDurationSeconds)}s`;
  const pct = Math.round(frame.spatialProgress * 100);

  ctx.fillStyle = 'rgba(10, 15, 26, 0.7)';
  ctx.fillRect(20, 20, 200, 32);
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'left';
  ctx.fillText(`⏱ ${timecode} (${pct}%)`, 32, 41);

  // Top Right: WAYVORA Studio watermark & resolution
  ctx.fillStyle = 'rgba(10, 15, 26, 0.7)';
  ctx.fillRect(width - 200, 20, 180, 32);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(`WAYVORA · ${width}×${height}`, width - 32, 41);

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
