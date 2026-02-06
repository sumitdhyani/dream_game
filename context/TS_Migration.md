# TypeScript Migration

## Overview
Migrated the entire codebase from JavaScript to TypeScript for type safety and better refactoring confidence.

## Files

| File | Purpose |
|------|---------|
| `FSM.ts` | Core state machine framework |
| `NetworkInterface.ts` | Bridge interfaces for component decoupling |
| `ComponentIntegration.ts` | Bridge setup and wiring |
| `GameEngineFSM.ts` | Game state logic |
| `GameRenderer.ts` | Phaser rendering scene |
| `GlobalGameReference.ts` | Game types and events |

## Configuration Files

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
│                    GameEngineFSM<GUIEventPayload, undefined>    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐    ┌───────────────────────────────┐ │
│  │ PreStart             │    │ PlayingRound                  │ │
│  │ State<GUIEventPayload│───▶│ State<GUIEventPayload,        │ │
│  │       undefined>     │    │       undefined>              │ │
│  └──────────────────────┘    └───────────────────────────────┘ │
│                                         │                       │
│                                         │ returns SubState      │
│                                         ▼                       │
│                              ┌───────────────────────────────┐ │
│                              │ TeleportingSubState           │ │
│                              │ SubState<GUIEventPayload,     │ │
│                              │          undefined>           │ │
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

### Event Payload Types

**GUI Event Payloads (from client to server):**
```typescript
// GlobalGameReference.ts
export type GUIEventPayload = KeyboardKey | GameConfig
```

**Game Event Payloads (from server to client):**
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
    | KeyboardKey
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
- `Logger` interface for logging abstraction (`info`, `warn`, `error`, `debug`)
- `Transition<TEventData, TResumePayload>` type: `State | SpecialTransition | void`
- Generic `State<TEventData, TResumePayload>` class
- Generic `FSM<TEventData, TResumePayload>` class  
- Generic `SubState<TEventData, TReturnPayload>` class

### NetworkInterface.ts
- `Logger` type (same interface as FSM.ts)
- `FGameEvtListener` - Function type for game event handlers
- `FGuiEventListener` - Function type for GUI event handlers
- `ClientSideNWInterface` - Client-side network interface
- `ServerSideNWInterface` - Server-side network interface

### GlobalGameReference.ts
- `Position` - `{x: number, y: number}`
- `Player` - player data with id, name, position, color, alive
- `BotPlayer` - extends Player with expertiseLevel
- `GameConfig` - botPlayers, roundDuration_ms, playerSpeed
- `Wormhole` - entrance, exit positions with color
- `EventType` - union of all game event constants
- `GuiEventType` - enum of GUI event names
- `GameEventPayload` - union of all game event payload types
- `GUIEventPayload` - union of GUI event payload types (KeyboardKey | GameConfig)
- `GameEvtHandler` - typed game event handler function
- `TargetGenerator` - function returning Position

### GameEngineFSM.ts
- `GameEvent = GameEventPayload` - FSM game event type
- Typed state classes with generic parameters:
  - `PreStart extends State<GUIEventPayload, undefined>`
  - `PlayingRound extends State<GUIEventPayload, undefined>`
  - `TeleportingSubState extends SubState<GUIEventPayload, undefined>`
  - `RoundEnded extends State<GUIEventPayload, undefined>`
  - `GameOver extends State<GUIEventPayload, undefined>`

### GameRenderer.ts
- Extends `Phaser.Scene` with typed properties
- `PendingEvent` interface for event queue
- Phaser loaded globally via CDN (not ES module import)
- Uses `declare const Phaser` for type access

---

## Architectural Changes from Original JavaScript

### 1. Bridge Pattern for Component Decoupling

**New Architecture:**
GameRenderer and GameEngineFSM communicate through Network Interfaces:
- `ClientSideNWInterface` wraps GameRenderer
- `ServerSideNWInterface` wraps GameEngineFSM
- `ComponentIntegration.ts` wires the bridge

This enables future swap to real WebSocket networking without changing game code.

### 2. SubState Pattern (Replaced CompositeState)

**New TS Architecture:**
Simple `SubState` pattern for short-lived child states:
- SubState is a lightweight child state that always returns to its parent
- No internal FSM overhead
- Event bubbling via exception catching
- Explicit `ReturnToParent` transition

### 3. Client-Driven Game Configuration

**New TS Architecture:**
Game configuration comes from client (GameRenderer):
- PreStart emits GAME_START event
- GameRenderer responds with game_configured event containing GameConfig
- FSM creates players based on configuration

### 4. Separate Event Types

**New TS Architecture:**
Clear separation between GUI and Game events:
- `GUIEventPayload` - Events from client to server (KeyboardKey, GameConfig)
- `GameEventPayload` - Events from server to client (Evt_RoundStart, etc.)

### 5. Event Routing Philosophy

**New TS:**
Clear event routing via Bridge:
1. GUI events: GameRenderer → ClientNW → ServerNW → GameEngineFSM
2. Game events: GameEngineFSM → ServerNW → ClientNW → GameRenderer
3. No hidden event transformation or interception

### 6. Lifecycle Hook Changes

**New TS:**
- `beforeExit()` - cleanup only (single responsibility)
- `getReturnPayload()` - separate method for returning results to parent
- `onPreemption()` - hook when parent yields to SubState
- `onResumeFromSubstate(payload)` - hook when SubState returns

### 7. State Chain Exit Order

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

### 8. Dependency Injection via Constructor

**New TS:**
All dependencies are passed via constructor parameters:
```typescript
constructor(
    gameEvtHandler: GameEvtHandler,
    targetGenerator: TargetGenerator,
    logger: Logger
) { ... }
```

### 9. Logger Interface

**New TS:**
Consistent `Logger` interface across all components:
```typescript
type Logger = {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
    debug(message: string): void
}
```

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

## Folder Structure

```
dream_game/
├── dist/                      # Compiled JS output (gitignored)
├── node_modules/              # Dependencies (gitignored)
├── context/                   # Documentation
│   ├── Context.md             # Project overview
│   ├── FSM_Design.md          # FSM design decisions
│   ├── IMPLEMENTATION_SUMMARY.md  # Implementation details
│   └── TS_Migration.md        # This file
├── RoboPlayer/                # (reserved for future use)
├── FSM.ts                     # Generic state machine framework
├── NetworkInterface.ts        # Bridge interfaces
├── ComponentIntegration.ts    # Bridge setup and wiring
├── GameEngineFSM.ts           # Game logic FSM
├── GameRenderer.ts            # Phaser rendering scene
├── GlobalGameReference.ts     # Shared types and events
├── index.html                 # Entry point (loads from ./dist/)
├── tsconfig.json              # TypeScript configuration
├── package.json               # npm configuration
└── package-lock.json          # Locked dependencies
```
