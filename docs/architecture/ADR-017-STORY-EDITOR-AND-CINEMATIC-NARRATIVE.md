# ADR-017: Story Editor, Narrative Timing, Cinematic Title Cards & Parity Rendering

**Status**: ACCEPTED  
**Date**: 2026-10-16  
**Domain**: Story Model, Timeline Evaluation, Cinematic Overlays, Transitions, Canvas Compositor, Studio UI & Serialization  

---

## 1. Context & Operational Requirements

WAYVORA's core brand promise is *"From Roads to Trails, Every Journey Becomes a Story."* Prior to Phase 5, the editor allowed setting basic camera intents and simple captions, but lacked structured multi-scene journey storytelling, cinematic opening and closing title cards, configurable destination dwell timing, validated scene transitions, and export-compositor parity for narrative overlays.

Key engineering and product constraints for Phase 5:
1. **Multi-Scene Storytelling**: Creators must be able to create, rename, reorder, adjust boundaries of, and delete scenes without destroying the underlying route geometry, waypoints, or segments.
2. **Deterministic Time-Based Evaluation**: Story state (active scene, title card, transition alpha, and dwell state) must be evaluated strictly against explicit timeline time ($t \in [0, \text{totalDuration}]$), never against variable wall-clock requestAnimationFrame state.
3. **Cinematic Opening & Closing Title Cards**: Configurable title and subtitle cards with fade-in, fade-out, duration, and restrained motion (`slow-zoom`, `fade`, `none`) that integrate into both the DOM studio preview and the 2D canvas video compositor.
4. **Transition Sets**: Support for `cut` (instantaneous scene switch without dark overlay), `crossfade`, and `fade-black` (dip to black) transitions with validated durations that cannot exceed the scene's time boundary.
5. **Preview / Export Parity**: What is seen in the Studio Center canvas must match the frames rendered during MP4/WebM export frame-for-frame.
6. **Backward Compatibility & Undo/Redo**: Projects saved in previous milestones (without Phase 5 fields) must deserialize without errors, and all story edits (reordering, scene timing, title cards) must support full undo/redo.

---

## 2. Domain Model Architecture

### 2.1 Extension to Timeline & Story Scene Types
The story domain in `app/src/domain/story/types.ts` and `app/src/domain/types.ts` was extended with minimal non-breaking additions:

```typescript
export type TitleCardMotion = 'none' | 'slow-zoom' | 'fade';

export interface TitleCardSettings {
  enabled: boolean;
  title: string;
  subtitle?: string;
  duration: number; // explicit seconds (> 0)
  motion?: TitleCardMotion;
}

export interface StoryTitleCards {
  opening: TitleCardSettings;
  closing: TitleCardSettings;
}

export interface ActiveTitleCardState {
  type: 'opening' | 'closing';
  title: string;
  subtitle?: string;
  opacity: number; // 0..1 smooth curve
  motionProgress: number; // 0..1 for deterministic scale/transform
  motion: TitleCardMotion;
}

export type TransitionType = 'cut' | 'crossfade' | 'fade-black';
```

Each `StoryScene` and `Scene` now includes:
- `dwellDuration?: number`: Optional dwell time in seconds at the associated stop.
- `stopId?: string`: Non-destructive link to a waypoint/stop.
- `segmentId?: string`: Non-destructive link to a route segment.
- `transition?: { type: TransitionType; duration: number }`: Transition settings entering the scene.

`Timeline` now includes optional `titleCards?: StoryTitleCards`.

---

## 3. Deterministic Story Evaluation

`evaluateStoryAtTime(timelineTime, scenes, titleCards, totalDuration)` evaluates story state at any continuous timestamp $t$:

1. **Title Card Evaluation**:
   - **Opening Card**: Active for $0 \le t \le \text{opening.duration}$. Fade window is $w = \min(0.6\text{s}, \text{duration} \times 0.25)$.
     - Fade-in: $t < w \implies \text{opacity} = t / w$.
     - Sustain: $w \le t \le \text{duration} - w \implies \text{opacity} = 1.0$.
     - Fade-out: $t > \text{duration} - w \implies \text{opacity} = (\text{duration} - t) / w$.
     - Motion progress: $t / \text{duration}$.
   - **Closing Card**: Active for $\text{totalDuration} - \text{closing.duration} \le t \le \text{totalDuration}$ with identical symmetric fade curves.

2. **Transition Set Evaluation**:
   - `cut`: Instantaneous switch at scene boundary; returns `transition: undefined` to prevent dark overlays or flickers.
   - `fade-black`: For $0 \le t - s_{\text{start}} < d_{\text{trans}}$, alpha follows a smooth triangle peak dip ($\sin(\pi \times \text{progress})$ or linear fold $\le 0.5$ fade down, $> 0.5$ fade up).
   - `crossfade`: Evaluates progress $0 \to 1$ across transition duration for canvas blend.

3. **Active Scene & Title / Caption Evaluation**:
   - Evaluates active scene using binary search or interval scan $s_{\text{start}} \le t < s_{\text{end}}$.
   - Scene title appears for $\min(3.5\text{s}, \text{duration} \times 0.5)$ with $0.4\text{s}$ fade.

---

## 4. Render Contract & Compositor Parity

In `app/src/domain/render/canvasCompositor.ts`:
- Extended `compositeRenderFrame` to draw `activeTitleCard` when present in `renderFrame.storyOverlay`.
- Added `drawCinematicFullTitleCard(ctx, width, height, titleCard)`:
  - Draws a cinematic dark radial vignette gradient overlay (`rgba(6, 10, 18, 0.88)` to `rgba(3, 5, 10, 0.96)`).
  - Handles `slow-zoom` motion deterministically: transforms canvas scale from $1.0$ to $1.04$ centered at screen midpoint based on `titleCard.motionProgress`.
  - Renders luxury typography: tracking-wide eyebrow, bold crisp title, modern gold/amber accent line, and elegant subtitle.
- Added transition overlay handling:
  - `fade-black`: Fills screen with `rgba(0, 0, 0, alpha)` where $\alpha = \sin(\pi \times \text{progress})$.
  - `crossfade`: Prepares blend alpha for scene layering.

DOM preview in `App.tsx` mirrors this logic identically via CSS classes `.cinematic-full-title-card` and `.cinematic-transition-veil`, bound to the evaluated story state.

---

## 5. Non-Destructive Referencing & Deletion Resilience

Deleting a stop via `deleteStop(journey, stopId)` previously risked leaving orphaned identifiers. The operation was hardened:
```typescript
const updatedScenes = (journey.timeline.scenes || []).map((sc) =>
  sc.stopId === stopId ? { ...sc, stopId: undefined } : sc
);
```
- Deleting a stop clears `stopId` from linked scenes without deleting the scenes or altering their timing.
- Deleting a scene (`deleteStoryScene`) removes only the scene from `journey.timeline.scenes`, leaving all waypoints, route geometry, and segments completely intact.

---

## 6. Verification & Parity Results

- **Automated Tests**: 281/281 unit tests pass across 21 test suites, including 20 comprehensive story tests (`app/src/__tests__/story.test.ts`).
- **Production Build**: `npm run build` completed with zero TypeScript errors.
- **Browser QA**: Verified end-to-end via browser automation:
  - Opening title card configured with "Alpine Crossing" / "A Cinematic Journey" with `slow-zoom`.
  - AutoStory scene generation, scene reordering (▲/▼), scene timing adjustments, and transition configuration (Fade Through Black, 1.5s).
  - Center preview playback verified with smooth title card presentation and transition overlay.
  - Video export studio resolution presets and render pipeline verified.
