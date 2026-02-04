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

## Key Type Definitions

### FSM.ts
- `Logger` interface for logging abstraction
- `Transition` type: `State | SpecialTransition`
- Generic `State`, `FSM`, `SubState` classes with typed events

### GlobalGameReference.ts
- `Position` - `{x: number, y: number}`
- `Player` - player data with id, position, color
- `Wormhole` - entrance, exit positions with color
- `EventType` - union of all game event names
- `GameEventPayload<T>` - maps event types to their payload types
- `GameEvtHandler` - typed event handler interface

### GameEngineFSM.ts
- Typed state classes: `PreStart`, `PlayingRound`, `TeleportingSubState`, `RoundEnded`, `GameOver`
- Dependencies passed via constructor for type safety

### GameRenderer.ts
- Extends `Phaser.Scene` with typed properties
- Phaser loaded globally via CDN (not ES module import)
- Uses `declare const Phaser` for type access

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

## Changes from Original JS

### Logger Property Visibility
Changed `logger` in `FSM` class from `protected` to `readonly` (public read) to allow states to access the logger via `this.selfFsm.logger`.

### Wormhole Rendering Fix
Fixed bug where `console.log()` was accidentally passed as first argument to `this.add.rectangle()` for wormhole entrance. Now only exit is rendered with color, entrance is invisible (just the connecting line).

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
