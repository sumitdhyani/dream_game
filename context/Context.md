# Dream Game - Project Context

## Project Overview
A **grid-based multiplayer game** where players move toward a target coordinate. At the end of each round, the farthest player from the target is eliminated. The game continues until only 1 player remains (the winner).

**Current State:** Client-side simulation with 3-4 players (p1=self, p2-p4=bots). Wormhole teleportation system in development.

---

## Game Mechanics

### Round Flow
1. **PlayingRound** → Players move toward the target for 15 seconds
2. **RoundEnded** → Farthest player(s) eliminated, prepare next round
3. **GameOver** → 1 player remains, show winner

### Target Assignment
- **New round starts:** Random target generated OR eliminated player's position becomes target
- **Self reaches target:** Target glows + blinks in self's color
- **Self leaves target:** Target reverts to original red color

### Wormholes
- 3-4 wormhole pairs per round
- One-way teleportation (entrance → exit)
- Color-coded (cyan, green, magenta, yellow)
- Visible at round start for strategic planning

---

## Architecture

### Core Classes

**FSM.js** - Generic state machine framework
- `State` - Base class for states
- `FSM` - State machine engine with deferral queue
- `CompositeState` - Hierarchical state support

**GameEngineFSM.js** - Game logic state machine
- `PreStart` → `PlayingRound` → `RoundEnded` → `GameOver`
- Inherits from `FSM`
- States manage: player movement, timer, bot AI, elimination logic

**GameRenderer.js** - Phaser-based rendering
- Renders grid, players, target, countdown timer
- Handles keyboard input → sends `key_press` events to FSM
- Listens to game events (ROUND_START, PLAYER_POSITIONS_UPDATE, etc.)

**GlobalGameReference.js** - Shared types & constants
- `Player`, `Position`, event classes (`Evt_RoundStart`, etc.)
- Constants: `GRID_W=20`, `GRID_H=20`, `CELL=32px`

---

## Movement System

### Design: Unified Throttle for All Players

**Mechanism:**
- All players (self + bots) share same `moveDelay` throttle
- Each player tracked in `lastMoveTimes` dict by `player.id`
- Timer check: `Date.now() - lastMoveTimes[id] < moveDelay` → skip move

**Self Player (on_key_press):**
1. Key pressed → check throttle
2. If throttle OK → move 1 grid cell, emit PLAYER_POSITIONS_UPDATE
3. Update lastMoveTime

**Bots (moveBot):**
1. Timer fires every 100ms
2. Check throttle → if throttle OK, proceed; else return
3. Move 1 cell (90% optimal toward target, 10% random)
4. Emit PLAYER_POSITIONS_UPDATE

**Result:** Both move exactly 1 cell per successful attempt. Fair, semantically equivalent.

---

## Data Flow

### Keyboard Input → Movement
```
User Input (Keyboard)
    ↓
GameRenderer.on_key_press()
    ↓
GameEngineFSM.handleEvent("key_press", key)
    ↓
PlayingRound.on_key_press(key)
    ↓ (updates self.position + bot positions)
    ↓
gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, ...)
    ↓
GameRenderer.onGameEvt()
    ↓
GameRenderer.update() → processPendingEvents()
    ↓
renderPlayers(players) → Phaser rectangles update
```

### Round End → Next Round
```
Timer expires (PlayingRound)
    ↓
GameEngineFSM.handleEvent("round_end")
    ↓
RoundEnded.on_launch() → eliminates farthest player
    ↓
gameEvtHandler(Events.ROUND_END, roundSummary)
    ↓
GameRenderer.handleRoundEnd(evt_round_end)
    ↓ (shows round summary for 2 seconds)
    ↓
GameEngineFSM.handleEvent("ready_to_host")  ← Renderer triggers this
    ↓
RoundEnded.on_ready_to_host() → new PlayingRound state
    ↓
Next round begins
```

---

## Key Methods

### PlayingRound

- `on_key_press(key)` - Self player movement with throttle
- `moveBot(botPlayer, target)` - Bot AI: 90% optimal, 10% random
- `on_round_end()` - Transition to RoundEnded state

### RoundEnded

- `findFarthestPlayerIdxs()` - Returns list of indices of players farthest from target
- `findLoserIdx()` - Returns first farthest player (picks randomly if tied)
- `eliminateLoser()` - Marks player as not alive, removes from activePlayers

---

## TODO / Not Yet Implemented

1. **Target Reaching Detection**
   - Check if any player reached target (distance ≤ 1?)
   - If all reach → trigger new round with new target
   - If some reach, some don't → run normal elimination

2. **Eliminated Player Position as Next Target**
   - RoundEnded.on_launch() should set next target = eliminated player's position
   - Currently: target is randomly generated each round

3. **Server/Multiplayer**
   - Currently all client-side simulation
   - Need backend for authoritative state, real players

---

## Minor Corrections

- Rename event name `ready_to_host` → `ready_to_render` (more semantically accurate: renderer is ready to render next round)

---

## Known Issues / Design Notes

- `self.moveDelay` referenced in PlayingRound but not always set (check initialization)
- GameRenderer creates 4 players but only 3 unique in array
- Console spam from render updates (can clean up later)

---

## Configuration

**In GameRenderer.js (create method):**
```javascript
new GameEngineFSM(
  this.onGameEvt.bind(this),
  players,
  players[0],        // self player
  targetGenerator,   // () => Position
  logger,
  100                // moveDelay in milliseconds
)
```

Adjust `100` to tune player/bot movement speed.
