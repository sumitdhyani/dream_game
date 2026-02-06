# Architecture Review

## Overview
This document provides an honest assessment of the project's High-Level Design (HLD) and Low-Level Design (LLD), including strengths, concerns, and recommendations.

---

## High-Level Design (HLD) — Strong

### Strengths

1. **Bridge Pattern for Decoupling**
   - Excellent foresight. Decoupling GameRenderer from GameEngineFSM via network interfaces is the right call for a game that might eventually go multiplayer.
   - Most hobby projects skip this and regret it later.

2. **Clear Separation of Concerns**
   - Renderer knows nothing about game logic
   - FSM knows nothing about Phaser
   - Clean boundary between components

3. **Event-Driven Architecture**
   - Using typed events for all communication is scalable and debuggable
   - Bidirectional flow (GUI events vs Game events) is well-defined

4. **Client-Driven Configuration**
   - The server (FSM) doesn't assume game parameters; it receives them
   - Supports future lobby/matchmaking scenarios

### Concerns

1. **Single-Player Tight Coupling**
   - Despite the bridge, `setupBridge()` instantiates the FSM *inside* the renderer's initialization
   - For real multiplayer, the FSM should live on a separate process/server
   - Current wiring is still fundamentally single-process

2. **No Clear "Game Session" Abstraction**
   - No explicit object managing lifecycle of a game session (start, pause, restart, end)
   - Currently implicit in the FSM states

---

## Low-Level Design (LLD) — Mostly Good, Some Rough Edges

### Strengths

1. **Generic FSM Framework**
   - `State<TEventData, TResumePayload>` generics provide real type safety
   - Event handlers are type-checked
   - Production-quality FSM design

2. **SubState Pattern**
   - Much cleaner than CompositeState for short-lived behaviors
   - Deferral mechanism via `deferralTransition` is elegant and avoids input loss

3. **Deterministic Lifecycle**
   - `onEntry`, `beforeExit`, `onPreemption`, `onResumeFromSubstate`
   - Well-thought-out hooks with clear semantics

4. **Event Bubbling**
   - SubState catching `UnhandledEvtException` and bubbling to parent
   - Consistent with existing FSM patterns

### Concerns

1. **`selfFsm` Pattern Feels Awkward**
   ```typescript
   const initState = new PreStart(..., null!, ...)
   super(() => initState, logger)
   initState.selfFsm = this  // <-- post-hoc assignment
   ```
   - This `null!` followed by assignment after construction is a TypeScript smell
   - Consider a factory pattern or passing a reference getter instead

2. **Logger Duplication**
   - Logger is defined in both `FSM.ts` and `NetworkInterface.ts` as separate types
   - Should share a single definition (perhaps in `GlobalGameReference.ts`)

3. **Hardcoded Magic Numbers**
   - Teleport animation: 600ms
   - Round summary display: 2000ms (in GameRenderer)
   - Bot move interval: hardcoded in PlayingRound
   - These should be constants or part of GameConfig

4. **Event Name Inconsistency**
   - GUI events use string enums (`GuiEventType.key_press`)
   - Game events use numeric constants (`Events.ROUND_START = 1`)
   - Pick one convention. String enums are more debuggable.

5. **`propagateGameEvt` Helper**
   ```typescript
   function propagateGameEvt(logger: Logger, gameEvtHandler: GameEvtHandler, type: EventType, evtData?: GameEventPayload)
   ```
   - Takes `logger` but doesn't use it (removed the null check)
   - Either remove the parameter or add logging

6. **Unused Import**
   - `use` from "matter" in ComponentIntegration.ts — dead code

7. **Player ID Collision Risk**
   - Self player is always `"self_id"`
   - If multiple human players are ever supported, this will break

---

## Architecture Maturity Ratings

| Aspect | Rating | Notes |
|--------|--------|-------|
| Separation of concerns | ⭐⭐⭐⭐ | Clean boundaries |
| Type safety | ⭐⭐⭐⭐ | Generics used well |
| Extensibility | ⭐⭐⭐⭐ | Easy to add new states/events |
| Testability | ⭐⭐⭐ | FSM is testable, but bridge wiring makes integration tests harder |
| Network readiness | ⭐⭐⭐ | Bridge exists but wiring is still synchronous/single-process |
| Code hygiene | ⭐⭐⭐ | Some dead code, magic numbers, duplicated types |

---

## Recommendations

### Immediate (Low Effort)

1. **Remove unused import** in ComponentIntegration.ts:
   ```typescript
   import { use } from "matter";  // Remove this
   ```

2. **Consolidate Logger type** — Move to GlobalGameReference.ts

3. **Extract magic numbers** to constants:
   ```typescript
   const TELEPORT_ANIMATION_MS = 600
   const ROUND_SUMMARY_DISPLAY_MS = 2000
   ```

### Medium Term

1. **Unify event naming convention** — Convert game events to string enums for consistency and debuggability

2. **Add logging to propagateGameEvt** — Since logger is passed, use it:
   ```typescript
   function propagateGameEvt(logger: Logger, gameEvtHandler: GameEvtHandler, type: EventType, evtData?: GameEventPayload) {
       logger.debug(`Emitting game event: ${type}`)
       gameEvtHandler(type, evtData)
   }
   ```

3. **Fix selfFsm pattern** — Use a factory or lazy getter pattern to avoid `null!`

### Long Term (Network Readiness Validation)

1. **Write a mock async bridge adapter** that introduces artificial latency
2. **Test what breaks** when `propagateGuiEvt` and `propagateGameEvt` become async
3. **Identify hidden assumptions** about event ordering and state consistency

---

## Validation Exercise

To truly validate the architecture is multiplayer-ready:

```typescript
// Mock async bridge adapter
class AsyncBridgeAdapter {
    private latencyMs: number = 50

    async propagateWithLatency(fn: () => void): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, this.latencyMs))
        fn()
    }
}
```

Questions to answer:
- What happens if ROUND_END arrives before PLAYER_POSITIONS_UPDATE?
- What if player input arrives after round has ended on server?
- Does the deferral queue handle async correctly?

---

## Summary

This is **above-average hobby project architecture** — better than most game jams or side projects. The FSM framework alone is reusable for other projects.

The main gap: the design *anticipates* multiplayer but doesn't *enforce* it. The bridge wiring is still synchronous. The recommendations above provide a path to validating and strengthening the architecture for real networking.

---

*Review Date: February 2026*
