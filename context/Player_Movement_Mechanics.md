# Player Movement Mechanics

## Overview
This document discusses the design of player/bot speed control mechanisms, the limitations of the current implementation, and recommended approaches for handling input throttling.

---

## Current Implementation

### Mechanism
- Uses `moveDelay` parameter to throttle movement
- Tracks `lastMoveTimes` dict: `playerId → timestamp of last move`
- On `key_press` event: checks if `Date.now() - lastMoveTimes[playerId] < moveDelay`
- If throttle not expired: **event is silently discarded**

### Code Pattern
```typescript
function handleKeyPress(key: KeyboardKey) {
    if (Date.now() - lastMoveTimes[playerId] < moveDelay) {
        return  // No move, no feedback
    }
    
    // Execute move
    player.position.x += deltaX
    lastMoveTimes[playerId] = Date.now()
}
```

### Configuration
- moveDelay: 50-500ms (configurable via Game Config UI)
- moveDelay: 100ms (typical default)
- moveDelay: 150ms (challenging difficulty)

---

## Strengths of Current Approach ✅

1. **Simplicity**
   - Minimal code, easy to understand
   - Direct timestamp checks are performant

2. **Works for Prototyping**
   - Sufficient for local single-player testing
   - Clear feedback (movement doesn't happen when throttled)

3. **Low Overhead**
   - No complex state management
   - No event listeners or callbacks

---

## Critical Limitations ❌

### 1. Input Loss (Major Issue)

The current approach **silently discards multiple key presses** during throttle windows.

#### Scenario: Single-Slot Queue Fallacy
A common proposed fix is to "queue the latest move":
```typescript
let queuedMove: KeyboardKey | null = null

function handleKeyPress(key: KeyboardKey) {
    if (Date.now() - lastMoveTimes[playerId] < moveDelay) {
        queuedMove = key  // Store for later
        return
    }
    
    executeMove(key)
}
```

**Problem**: This only stores ONE move. Multiple inputs are lost.

#### Example: Held Key Input Loss
```
Timeline (moveDelay = 100ms):

t=0ms:    User presses UP
          → Executes immediately
          → nextMoveTime = 100ms

t=50ms:   User presses RIGHT (still held)
          → Throttled, stores queuedMove = RIGHT

t=75ms:   OS generates UP repeat (user still holding)
          → queuedMove updated: RIGHT is LOST
          → queuedMove = UP

t=100ms:  RIGHT is no longer in queue
          → executeMove(UP)
          → User intended UP+RIGHT but got only UP
```

### 2. Input Probability Higher Than Expected

While moveDelay defaults to 100ms, input loss is **likely, not rare**:

- moveDelay = 100ms
- Frame rate = 60fps (16.67ms per frame)
- **6+ frames of input events possible in throttle window**
- OS keyboard repeat rate typically 30-100Hz
- Multiple simultaneous key presses common in games

### 3. Event-Driven Problems

Current approach is **purely reactive polling**:
- Input handler checks timestamp
- No coordination between throttle enforcement and input acceptance
- No way to provide feedback ("move available in Xms")

### 4. Networking Incompatible

For future multiplayer:
- Events could arrive out-of-order on client/server
- No deterministic replay mechanism
- Race conditions on client-server state sync
- No way to reconcile local throttle with server timing

### 5. Difficult to Extend

Adding new mechanics breaks the simple model:

**Speed Boosts:**
```typescript
// How do you dynamically change moveDelay mid-round?
// Reset the timer? Skip a move? Confusing semantics.
```

**Frozen/Stunned State:**
```typescript
// Need separate flag checking - no unified system
```

**Client Prediction:**
```typescript
// Can the client predict when server will allow next move?
// Not without recreating server-side logic
```

### 6. Non-Deterministic Testing

- Tests depend on real time progression
- Hard to reproduce timing issues
- No way to fast-forward or replay

---

## Better Approaches

### Option A: True FIFO Input Queue

**Mechanism**: Store all key presses in a proper queue, process one per throttle interval.

```typescript
class InputQueue {
    private queue: KeyboardKey[] = []
    private lastMoveTime: number = 0

    enqueue(key: KeyboardKey): void {
        this.queue.push(key)
    }

    tryExecuteNextMove(moveDelay: number, now: number): boolean {
        if (this.queue.length === 0) {
            return false
        }

        if (now - this.lastMoveTime >= moveDelay) {
            const key = this.queue.shift()!
            executeMove(key)
            this.lastMoveTime = now
            return true
        }

        return false
    }

    hasPendingInput(): boolean {
        return this.queue.length > 0
    }
}
```

**Pros**:
- No input loss
- Clear semantics
- Easy to visualize queue state

**Cons**:
- Queue could grow unbounded if player hammers keys
- Still polling-based in update loop

---

### Option B: Event-Driven Movement Scheduler (Recommended)

**Mechanism**: Emit "player_ready_to_move" event when throttle expires. Input is stored separately until move is allowed.

```typescript
class MovementScheduler {
    private nextMoveTime: Record<string, number> = {}
    private moveDelay: number
    private readyCallbacks: Map<string, () => void> = new Map()

    constructor(moveDelay: number) {
        this.moveDelay = moveDelay
    }

    canMove(playerId: string, now: number): boolean {
        return now >= (this.nextMoveTime[playerId] ?? 0)
    }

    recordMove(playerId: string, now: number): void {
        this.nextMoveTime[playerId] = now + this.moveDelay
    }

    getTimeUntilNextMove(playerId: string, now: number): number {
        return Math.max(0, (this.nextMoveTime[playerId] ?? 0) - now)
    }

    setMoveDelay(moveDelay: number): void {
        this.moveDelay = moveDelay
    }

    onPlayerReady(playerId: string, callback: () => void): void {
        this.readyCallbacks.set(playerId, callback)
    }

    update(now: number): void {
        for (const [playerId, nextTime] of Object.entries(this.nextMoveTime)) {
            if (now >= nextTime && this.readyCallbacks.has(playerId)) {
                this.readyCallbacks.get(playerId)!()
            }
        }
    }

    setMoveDelay(newDelay: number): void {
        this.moveDelay = newDelay
    }
}
```

**Usage Flow**:
```
1. Input arrives: store in buffer
2. Scheduler.update() fires every frame
3. If (now >= nextMoveTime): emit "player_ready_to_move"
4. Listener (FSM) processes input from buffer
5. FSM calls scheduler.recordMove(playerId, now)
```

**Pros**:
- Event-driven (reactive to scheduler, not polling)
- Clear separation: throttle logic vs input logic
- Easy to provide feedback to UI
- Extensible (add speed boosts, frozen state)
- Testable without real time
- Networking-ready

**Cons**:
- Slightly more code
- Requires coordination between scheduler and input handler

---

### Option C: Tick-Based Movement (Most Deterministic)

**Mechanism**: Movement happens on fixed game ticks, not real time.

```typescript
class GameTick {
    private currentTick: number = 0
    private readonly TICK_RATE: number = 60  // ticks per second

    canPlayerMove(playerId: string, lastMoveTick: number, moveDelay: number): boolean {
        return this.currentTick - lastMoveTick >= moveDelay
    }

    tick(): void {
        this.currentTick++
    }

    getCurrentTick(): number {
        return this.currentTick
    }
}
```

**Pros**:
- Fully deterministic
- Easy to replay (just replay tick sequence)
- Perfect for networking (clients/servers sync on tick)
- Easy to test (no real time involved)
- Consistent game speed regardless of frame rate

**Cons**:
- Requires restructuring game loop around ticks
- More work to implement

---

## Recommended Path Forward

### Immediate (No Major Refactor)
**Option A: True FIFO Queue**
- Minimal change to existing code
- Solves input loss without restructuring
- Add to GameEngineFSM.PlayingRound

### Medium Term (Cleaner Architecture)
**Option B: Event-Driven Scheduler**
- Create `MovementScheduler` class in GlobalGameReference.ts
- Integrate with FSM event flow
- Enables future extensions (speed boosts, frozen state)
- Better testability

### Long Term (Multiplayer-Ready)
**Option C: Tick-Based Movement**
- Restructure game loop to tick-based
- Enables true client/server synchronization
- Deterministic replay for debugging/spectating

---

## Key Insights

1. **Single-slot queue is not a queue**
   - Calling it a "queue" when storing only one element is misleading
   - It still loses input

2. **Polling-based throttling is fundamentally flawed for input**
   - Events are inherently unpredictable
   - Any attempt to queue must capture ALL events
   - Current approach only captures one

3. **Input loss probability is understated**
   - At typical moveDelay (100ms) and 60fps
   - 6+ input events possible in throttle window
   - Option to lose input is realistic, not edge case

4. **Networking validates the criticism**
   - Any future multiplayer requires deterministic movement
   - Current polling-based approach won't scale
   - Event-driven or tick-based required eventually

---

## Decision Matrix

| Approach | Implementation | Input Loss | Testing | Networking | Extensibility |
|----------|----------------|-----------|---------|-----------|---------------|
| Current (Polling) | ⭐⭐⭐⭐⭐ | ❌ Loss | ❌ Hard | ❌ No | ⭐ Limited |
| Option A (FIFO) | ⭐⭐⭐⭐ | ✅ None | ⭐⭐⭐ | ⭐ Partial | ⭐⭐⭐ |
| Option B (Event) | ⭐⭐⭐ | ✅ None | ✅ Easy | ✅ Yes | ✅ Good |
| Option C (Tick) | ⭐⭐ | ✅ None | ✅ Perfect | ✅ Perfect | ✅ Excellent |

---

## Conclusion

The critique that **"single-slot queue loses input, especially on held keys"** is **valid and accurate**. 

Current polling-based approach has fundamental limitations that will become problems if the game scales to:
- Multiple simultaneous key presses
- Speed boost/slow effects
- Multiplayer networking
- Deterministic replay/spectating

**Recommended next step**: Implement **Option A (True FIFO) or Option B (Event-Driven)** depending on whether you want minimal refactor or cleaner architecture.

---

## LATEST STATE: Implemented Design (February 2026)

After discussion, we decided on a hybrid approach combining **Tick-Based Movement (Option C)** with **Client Timestamps** and **Injectable Strategies**.

### Final Architecture

#### Core Design Decisions

1. **Tick-Based Processing**
   - Fixed motion tick interval: 40ms (25 ticks/second)
   - Server emits `PLAYER_POSITIONS_UPDATE` each tick
   - Tick interval constant throughout game session

2. **Client Timestamps**
   - Each keypress includes `clientTimestamp: number`
   - Server computes `clockOffset` at connection handshake (prepared for multiplayer)
   - Server maps `adjustedTime = clientTimestamp + clockOffset` → tick number
   - For local play: clockOffset = 0

3. **Input Handling: First-Wins**
   - One input processed per player per tick
   - If multiple inputs map to same tick: first processed, rest discarded
   - No input queue (queue size = 1 implicitly)
   - Acceptable trade-off: at 40ms ticks vs 150-250ms human reaction time, meaningful input loss is unlikely

4. **Per-Player Speed Control via Accumulator Pattern**
   ```typescript
   Each tick:
       accumulator = min(accumulator + speedMultiplier, MAX_CREDITS)

   On input:
       if accumulator >= 1.0:
           move player
           accumulator -= 1.0
   ```
   - `speedMultiplier`: per-player, default 1.0 (runtime modifiable)
   - `MAX_CREDITS`: 2 (prevents burst after idle)
   - Tick interval: fixed for all players

### Injectable Strategies

The movement system uses dependency injection for flexibility:

| Component | Injectable? | Rationale |
|-----------|-------------|-----------|
| Tick timer | ❌ FSM owns | Infrastructure, side-effectful |
| Clock sync | ❌ FSM owns | Networking concern |
| Accumulator logic | ❌ FSM owns | Pattern is fixed |
| **SpeedProvider** | ✅ Injected | Varies by power-ups, terrain, player type |
| **MoveResolver** | ✅ Injected | Varies by obstacles, boundaries, wrap-around |

#### SpeedProvider Type
```typescript
type SpeedProvider = (player: Player, context: SpeedContext) => number

interface SpeedContext {
    roundNumber: number
    tickNumber: number
    // Future: terrain type, power-ups, etc.
}
```

**Implementations:**
- `constant(1.0)` — All players same speed
- `fast(1.5)` — 50% faster
- `slow(0.5)` — Half speed  
- `progressive` — Speed increases with round number
- `perPlayer(map)` — Individual player speeds

#### MoveResolver Type
```typescript
type MoveResolver = (
    player: Player,
    direction: Direction,
    context: MoveContext
) => Position | null

interface MoveContext {
    gridWidth: number
    gridHeight: number
    // Future: obstacles, other players, etc.
}
```

**Implementations:**
- `simple` — Clamp to grid boundaries
- `wrapping` — Wrap around edges
- `blocking` — Return null if blocked

### Files Created/Modified

| File | Change |
|------|--------|
| `MovementStrategies.ts` | **NEW** - Contains all types, SpeedProviders, MoveResolvers, MovementController |
| `GlobalGameReference.ts` | Added `KeyPressEvent` class, re-exported movement types |
| `GameRenderer.ts` | Sends `KeyPressEvent` with `clientTimestamp` instead of raw key |
| `GameEngineFSM.ts` | Uses `MovementController`, motion tick timer, accumulator pattern |
| `ComponentIntegration.ts` | Injects `DefaultMovementConfig`, `SpeedProviders.constant`, `MoveResolvers.simple` |

### MovementController Class

The central class managing tick-based movement:

```typescript
class MovementController {
    constructor(
        config: MovementConfig,
        speedProvider: SpeedProvider,
        moveResolver: MoveResolver
    )

    initPlayer(playerId: string): void
    removePlayer(playerId: string): void
    
    bufferInput(
        playerId: string,
        key: KeyboardKey,
        clientTimestamp: number,
        clockOffset: number,
        gameStartTime: number
    ): void
    
    processTick(
        players: Player[],
        roundNumber: number,
        moveContext: MoveContext
    ): Player[]  // Returns players who moved
    
    reset(): void
}
```

### Configuration

```typescript
interface MovementConfig {
    tickIntervalMs: number      // Default: 40ms (25 ticks/sec)
    maxAccumulatedMoves: number // Default: 2 (slight buffer)
}
```

### What's Deferred

| Item | Reason |
|------|--------|
| Input coalescing (diagonal) | Low value-add now, complexity cost |
| Full input queue (FIFO) | First-wins acceptable at small tick interval |
| Client-side prediction | Not needed for local/beta |
| Clock sync protocol | Infrastructure ready, not implemented until multiplayer |

### Runtime Speed Modification

To change player speed at runtime:
1. Use `createPerPlayerSpeedProvider(map)` 
2. Update the map externally
3. Next tick picks up new speed automatically

---

*Last Updated: February 8, 2026*
