# TypeScript Migration

## Overview
Migrated the entire codebase from JavaScript to TypeScript for type safety and better refactoring confidence.

## Files Migrated

| Original JS File | New TS File | Purpose |
|-----------------|-------------|---------|
| `FSM.js` | `FSM.ts` | Core state machine framework |
| `GameEngineFSM.js` | `GameEngineFSM.ts` | Game state logic |
| `GameRenderer.js` | `GameRenderer.ts` | Phaser rendering scene |
| `GlobalGameReference.js` | `GlobalGameReference.ts` | Game types and events |

## New Configuration Files

- `tsconfig.json` - TypeScript compiler configuration
- `package.json` - npm project with dependencies
- `package-lock.json` - locked dependency versions

---

## Generic Type System Design

### Motivation: Eliminating `unknown` Types

The initial TypeScript migration used `unknown` for event data and payloads throughout the FSM framework. While this compiled, it defeated much of the purpose of TypeScript:

```typescript
// ❌ Before: unknown types everywhere
react(evtName: string, evtData: unknown): Transition
onResumeFromSubstate(payload: unknown): void
getReturnPayload(): unknown
```

This required unsafe type assertions at every usage point and provided no compile-time guarantees.

### Solution: Generic Type Parameters

The FSM framework now uses three generic type parameters for full type safety:

| Class | Type Parameters | Purpose |
|-------|-----------------|---------|
| `State<TEventData, TResumePayload>` | Event data type, Payload received from SubState |
| `SubState<TEventData, TReturnPayload>` | Event data type, Payload returned to parent |
| `FSM<TEventData>` | Event data type for the entire state machine |
| `Transition<TEventData>` | Typed state transitions |

### Type Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GameEngineFSM<GameEvent>                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐    ┌───────────────────────────────┐ │
│  │ PreStart             │    │ PlayingRound                  │ │
│  │ State<GameEvent>     │───▶│ State<GameEvent, undefined>   │ │
│  └──────────────────────┘    └───────────────────────────────┘ │
│                                         │                       │
│                                         │ returns SubState      │
│                                         ▼                       │
│                              ┌───────────────────────────────┐ │
│                              │ TeleportingSubState           │ │
│                              │ SubState<GameEvent, undefined>│ │
│                              └───────────────────────────────┘ │
│                                         │                       │
│                                         │ ReturnToParent        │
│                                         │ payload: undefined    │
│                                         ▼                       │
│                              ┌───────────────────────────────┐ │
│                              │ PlayingRound                  │ │
│                              │ onResumeFromSubstate(undef)   │ │
│                              └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### GameEvent Type Definition

All FSM event data is typed through a discriminated union:

```typescript
// GlobalGameReference.ts
export type GameEventPayload = 
    | Evt_GameStart
    | Evt_RoundStart
    | Evt_RoundEnd
    | Evt_GameOver
    | Evt_PlayerPositionsUpdate
    | Evt_TimerTick
    | Evt_SelfReachedTarget
    | Evt_SelfLeftTarget
    | Evt_PlayerTeleported
    | KeyboardKey              // Added for key_press events

// GameEngineFSM.ts
export type GameEvent = GameEventPayload | null
```

### Typed Event Handlers

Event handlers now receive properly typed parameters:

```typescript
// ✅ After: Fully typed
on_key_press(key: KeyboardKey): Transition<GameEvent> {
    switch (key) {
        case keyboardKeys.UP:    this.self.position.y--; break
        case keyboardKeys.DOWN:  this.self.position.y++; break
        case keyboardKeys.LEFT:  this.self.position.x--; break
        case keyboardKeys.RIGHT: this.self.position.x++; break
    }
}
```

### Typed SubState Return Payloads

The connection between SubState return type and parent's `onResumeFromSubstate` is now type-checked:

```typescript
// SubState declares what it returns
class TeleportingSubState extends SubState<GameEvent, undefined> {
    getReturnPayload(): undefined {
        return undefined
    }
}

// Parent declares what it expects
class PlayingRound extends State<GameEvent, undefined> {
    onResumeFromSubstate(_payload: undefined): void {
        // Type-safe: payload is guaranteed to be undefined
        this.checkSelfReachedTarget()
    }
}
```

### Future Extension Example

If `TeleportingSubState` needed to return data (e.g., teleport result):

```typescript
// Define the payload type
interface TeleportResult {
    exitPosition: Position
    teleportDuration: number
}

// SubState returns TeleportResult
class TeleportingSubState extends SubState<GameEvent, TeleportResult> {
    getReturnPayload(): TeleportResult {
        return {
            exitPosition: this.wormhole.exit,
            teleportDuration: 600
        }
    }
}

// Parent expects TeleportResult
class PlayingRound extends State<GameEvent, TeleportResult> {
    onResumeFromSubstate(payload: TeleportResult): void {
        console.log(`Teleported to ${payload.exitPosition.x}, ${payload.exitPosition.y}`)
        console.log(`Animation took ${payload.teleportDuration}ms`)
    }
}
```

---

## Key Type Definitions

### FSM.ts
- `Logger` interface for logging abstraction
- `Transition<TEventData>` type: `State<TEventData> | SpecialTransition | void`
- Generic `State<TEventData, TResumePayload>` class
- Generic `FSM<TEventData>` class  
- Generic `SubState<TEventData, TReturnPayload>` class

### GlobalGameReference.ts
- `Position` - `{x: number, y: number}`
- `Player` - player data with id, position, color
- `Wormhole` - entrance, exit positions with color
- `EventType` - union of all game event names
- `GameEventPayload` - union of all event payload types
- `KeyboardKey` - union of keyboard direction constants
- `GameEvtHandler` - typed event handler interface

### GameEngineFSM.ts
- `GameEvent = GameEventPayload | null` - FSM event type
- Typed state classes with generic parameters:
  - `PreStart extends State<GameEvent>`
  - `PlayingRound extends State<GameEvent, undefined>`
  - `TeleportingSubState extends SubState<GameEvent, undefined>`
  - `RoundEnded extends State<GameEvent>`
  - `GameOver extends State<GameEvent>`

### GameRenderer.ts
- Extends `Phaser.Scene` with typed properties
- Phaser loaded globally via CDN (not ES module import)
- Uses `declare const Phaser` for type access

---

## Architectural Changes from Original JavaScript

### 1. CompositeState → SubState Pattern

**Original JS Architecture:**
The original JavaScript code used a `CompositeState` pattern for nested state behavior. CompositeState maintained its own internal FSM, which added complexity for simple use cases like teleportation animation.

**New TS Architecture:**
Replaced with a simpler `SubState` pattern:
- SubState is a lightweight child state that always returns to its parent
- No internal FSM overhead
- Event bubbling via exception catching (aligns with existing FSM patterns)
- Explicit `ReturnToParent` transition instead of automatic completion

### 2. Event Routing Philosophy

**Original JS:**
Events were routed through CompositeState's internal FSM, which could intercept, transform, or forward events unpredictably.

**New TS:**
Clear event routing hierarchy:
1. Events go directly to `currState` (which may be a SubState)
2. SubState handles or explicitly bubbles to parent via `UnhandledEvtException`
3. Parent can handle bubbled events and return transitions
4. No hidden event transformation or interception

### 3. Lifecycle Hook Changes

**Original JS:**
- `beforeExit()` served dual purpose: cleanup AND returning results

**New TS:**
- `beforeExit()` - cleanup only (single responsibility)
- `getReturnPayload()` - separate method for returning results to parent
- `onPreemption()` - new hook when parent yields to SubState
- `onResumeFromSubstate(payload)` - new hook when SubState returns

### 4. State Chain Exit Order

**Original JS:**
Exit order was not well-defined for nested states.

**New TS:**
Deterministic walk-up exit via `exitStateChain()`:
```typescript
exitStateChain(state: State): void {
    state.beforeExit()           // Child exits first
    if (state instanceof SubState) {
        this.exitStateChain(state.parent)  // Then parent
    }
}
```
This mirrors C++ destructor ordering (child before parent).

### 5. Dependency Injection via Constructor

**Original JS:**
States often accessed globals or reached into other objects for dependencies.

**New TS:**
All dependencies are passed via constructor parameters:
```typescript
constructor(
    gameEvtHandler: GameEvtHandler,
    players: Player[],
    self: Player,
    targetGenerator: TargetGenerator,
    selfFsm: GameEngineFSM,
    moveDelay: number
) { ... }
```

Benefits:
- Explicit dependency graph
- Easier testing (mock dependencies)
- Type-checked at construction time
- No hidden coupling

### 6. Logger Access Pattern

**Original JS:**
Logger was accessed inconsistently, sometimes via globals.

**New TS:**
- `FSM.logger` is `readonly` (public read access)
- States receive logger via constructor or access via `this.selfFsm.logger`
- Consistent `Logger` interface: `info(message: string)`, `warn(message: string)`

### 7. Wormhole Rendering Bug Fix

**Original JS (Bug):**
```javascript
const entranceRect = this.add.rectangle(
    console.log(`Wormhole entrance...`),  // ← Bug: console.log returns undefined
    w.entrance.x * CELL + CELL / 2,       // ← This became y position
    ...
)
```
The `console.log()` was accidentally passed as the x-coordinate, causing entrance rectangles to render at position `undefined` (coerced to 0 or off-screen).

**New TS (Fixed):**
Only exit is rendered with color; entrance is invisible with just the connecting line (intentional design decision after discovering the bug).

---

## Build Process

```bash
# Compile TypeScript to JavaScript
npx tsc

# Watch mode (auto-recompile on save)
npx tsc --watch
```

Output goes to `./dist/` folder.

## Browser Compatibility

- All local imports include `.js` extension for browser ES module resolution
- Phaser loaded via CDN script tag, accessed as global
- `index.html` imports from `./dist/` folder

## Folder Structure After Migration

```
dream_game/
├── dist/                    # Compiled JS output (gitignored)
├── node_modules/            # Dependencies (gitignored)
├── FSM.ts                   # Source
├── GameEngineFSM.ts         # Source
├── GameRenderer.ts          # Source
├── GlobalGameReference.ts   # Source
├── index.html               # Entry point (loads from ./dist/)
├── tsconfig.json            # TS config
├── package.json             # npm config
└── package-lock.json        # Locked deps
```
