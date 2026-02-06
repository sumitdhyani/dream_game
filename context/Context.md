# Dream Game - Project Context

## Project Overview
A **grid-based multiplayer game** where players move toward a target coordinate. At the end of each round, the farthest player from the target is eliminated. The game continues until only 1 player remains (the winner).

**Current State:** Client-side simulation with decoupled architecture. GameRenderer and GameEngineFSM communicate via Network Interface bridge, enabling future swap to real networking.

---

## Game Mechanics

### Round Flow
1. **PreStart** → Game starts, waits for configuration from client
2. **PlayingRound** → Players move toward the target (configurable duration, default 10s)
3. **RoundEnded** → Farthest player(s) eliminated, prepare next round
4. **GameOver** → 1 player remains, show winner

### Target Assignment
- **New round starts:** Random target generated via `targetGenerator()`
- **Self reaches target:** Target glows + blinks in self's color
- **Self leaves target:** Target reverts to original red color

### Wormholes
- 3 wormhole pairs per round
- One-way teleportation (entrance → exit)
- Color-coded (cyan, green, magenta, yellow)
- Visible at round start for strategic planning

---

## Architecture

### Core Components

**FSM.ts** - Generic state machine framework
- `State<TEventData, TResumePayload>` - Base class for states
- `FSM<TEventData, TResumePayload>` - State machine engine with deferral queue
- `SubState<TEventData, TReturnPayload>` - Lightweight child state pattern

**NetworkInterface.ts** - Bridge between Client and Server sides
- `ClientSideNWInterface` - Used by GameRenderer for GUI events
- `ServerSideNWInterface` - Used by GameEngineFSM for game events
- `Logger` - Logging interface for debugging

**ComponentIntegration.ts** - Wiring and bridge setup
- `setupBridge(gameRenderer)` - Instantiates and wires all interfaces
- Creates bidirectional event flow between renderer and FSM

**GameEngineFSM.ts** - Game logic state machine
- `PreStart` → `PlayingRound` → `RoundEnded` → `GameOver`
- Uses `GUIEventPayload` for input events
- Emits `GameEventPayload` for game state changes

**GameRenderer.ts** - Phaser-based rendering
- Renders grid, players, target, countdown timer, wormholes
- Sends GUI events via `ClientSideNWInterface`
- Receives game events and queues for processing in update loop

**GlobalGameReference.ts** - Shared types & constants
- `Player`, `BotPlayer`, `Position`, `Wormhole`, `GameConfig`
- Event classes: `Evt_RoundStart`, `Evt_PlayerPositionsUpdate`, etc.
- Constants: `GRID_W=40`, `GRID_H=40`, `CELL=32px`

---

## Movement System

### Design: Unified Throttle for All Players

**Mechanism:**
- All players (self + bots) share same `moveDelay` throttle (configured via `GameConfig.playerSpeed`)
- Each player tracked in `lastMoveTimes` dict by `player.id`
- Timer check: `Date.now() - lastMoveTimes[id] < moveDelay` → skip move

**Self Player (on_key_press):**
1. Key pressed → check throttle
2. If throttle OK → move 1 grid cell, emit PLAYER_POSITIONS_UPDATE
3. Update lastMoveTime

**Bots (moveBot):**
1. Timer fires periodically
2. Check throttle → if throttle OK, proceed; else return
3. Move 1 cell (90% optimal toward target, 10% random)
4. Emit PLAYER_POSITIONS_UPDATE

**Result:** Both move exactly 1 cell per successful attempt. Fair, semantically equivalent.

---

## Data Flow (Bridge Architecture)

### GUI Event Flow (User Input → FSM)
```
User Input (Keyboard)
    ↓
GameRenderer.propagateGuiEvt(GuiEventType.key_press, keyboardKey)
    ↓
ClientSideNWInterface.onGuiEvent()
    ↓
ClientSideNWInterface.propagateGuiEvt() ──BRIDGE──▶ ServerSideNWInterface.onGuiEvent()
    ↓
ServerSideNWInterface.propagateGuiEvt()
    ↓
GameEngineFSM.handleEvent("key_press", key)
    ↓
PlayingRound.on_key_press(key) → updates player positions
```

### Game Event Flow (FSM → Renderer)
```
PlayingRound state change
    ↓
propagateGameEvt(logger, gameEvtHandler, Events.PLAYER_POSITIONS_UPDATE, ...)
    ↓
ServerSideNWInterface.onGameEvt()
    ↓
ServerSideNWInterface.propagateGameEvt() ──BRIDGE──▶ ClientSideNWInterface.onGameEvt()
    ↓
ClientSideNWInterface.propagateGameEvt()
    ↓
GameRenderer.onGameEvt() → queues event
    ↓
GameRenderer.update() → processPendingEvents()
    ↓
renderPlayers(players) → Phaser rectangles update
```

### Bridge Diagram
```
[GameRenderer] <-> [ClientSideNWInterface] <==BRIDGE==> [ServerSideNWInterface] <-> [GameEngineFSM]

GUI Events:  GameRenderer ──────▶ ClientNW ──────▶ ServerNW ──────▶ GameEngineFSM
Game Events: GameRenderer ◀────── ClientNW ◀────── ServerNW ◀────── GameEngineFSM
```

### Game Configuration Flow
```
GameRenderer receives GAME_START event
    ↓
handleGameStart() creates GameConfig
    ↓
GameConfig = {
    botPlayers: [Bot1, Bot2, Bot3],
    roundDuration_ms: 10000,
    playerSpeed: 100  // moveDelay in ms
}
    ↓
propagateGuiEvt(GuiEventType.game_configured, gameConfig)
    ↓
PreStart.on_game_configured(gameConfig)
    ↓
Creates players (bots + self), transitions to PlayingRound
```

### Round End → Next Round
```
Timer expires (PlayingRound)
    ↓
GameEngineFSM.handleEvent("round_end")
    ↓
RoundEnded.on_launch() → eliminates farthest player
    ↓
propagateGameEvt(Events.ROUND_END, roundSummary)
    ↓
GameRenderer.handleRoundEnd(evt_round_end)
    ↓ (shows round summary for 2 seconds)
    ↓
propagateGuiEvt(GuiEventType.ready_to_host)
    ↓
RoundEnded.on_ready_to_host() → new PlayingRound state
    ↓
Next round begins
```

---

## Key Methods

### PreStart
- `onEntry()` - Emits GAME_START event to signal renderer
- `on_game_configured(gameConfig)` - Receives client config, creates players, transitions to PlayingRound

### PlayingRound
- `on_key_press(key)` - Self player movement with throttle
- `moveBot(botPlayer, target)` - Bot AI: 90% optimal, 10% random
- `on_round_end()` - Transition to RoundEnded state
- `checkWormholeTeleport()` - Detects wormhole entrance, transitions to TeleportingSubState

### TeleportingSubState
- `onEntry()` - Teleports player, emits PLAYER_TELEPORTED, starts animation timer
- `on_key_press()` - Returns deferralTransition to queue input during animation
- `on_teleport_complete()` - Returns to parent PlayingRound

### RoundEnded
- `findFarthestPlayerIdxs()` - Returns list of indices of players farthest from target
- `findLoserIdx()` - Returns first farthest player (picks randomly if tied)
- `eliminateLoser()` - Marks player as not alive, removes from activePlayers
- `on_ready_to_host()` - Transitions to next PlayingRound

---

## Event Types

### GUI Events (Client → Server)
| Event | Payload | Description |
|-------|---------|-------------|
| `key_press` | `KeyboardKey` | Arrow key pressed |
| `game_configured` | `GameConfig` | Client sends game configuration |
| `ready_to_host` | none | Renderer ready for next round |

### Game Events (Server → Client)
| Event | Payload | Description |
|-------|---------|-------------|
| `GAME_START` | none | Signal to show config UI |
| `ROUND_START` | `Evt_RoundStart` | Round begins, includes players/target/wormholes |
| `ROUND_END` | `Evt_RoundEnd` | Round ends with summary |
| `PLAYER_POSITIONS_UPDATE` | `Evt_PlayerPositionsUpdate` | Player positions changed |
| `TIMER_TICK` | `Evt_TimerTick` | Countdown update |
| `SELF_REACHED_TARGET` | `Evt_SelfReachedTarget` | Self player at target |
| `SELF_LEFT_TARGET` | `Evt_SelfLeftTarget` | Self player left target |
| `PLAYER_TELEPORTED` | `Evt_PlayerTeleported` | Player used wormhole |
| `GAME_OVER` | `Evt_GameOver` | Game finished, winner declared |

---

## Configuration

**GameConfig (sent by GameRenderer on GAME_START):**
```typescript
new GameConfig(
    [new BotPlayer("bot1", "Bot 1", new Position(0, 0), 0x00ff00, 1),
     new BotPlayer("bot2", "Bot 2", new Position(0, 0), 0x00aaff, 2),
     new BotPlayer("bot3", "Bot 3", new Position(0, 0), 0xffaa00, 3)],
    10000,  // roundDuration_ms
    100     // playerSpeed (moveDelay in ms)
)
```

---

## Known Issues / Design Notes

- Grid size is 40x40 (not 20x20 as previously documented)
- Console spam from render updates (can clean up later)
- Self player is always created with id "self_id" and name "You", color red (0xff0000)

---

## Future Networking

The Bridge architecture is designed for easy swap to real networking:
1. Replace `ClientSideNWInterface.propagateGuiEvt` wiring with WebSocket send
2. Replace `ServerSideNWInterface.propagateGameEvt` wiring with WebSocket receive
3. All event types and payloads remain the same
4. GameRenderer and GameEngineFSM code unchanged
