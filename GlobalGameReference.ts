// ============================================================================
// Game Types & Constants
// ============================================================================

export const CELL = 32
export const GRID_W = 80
export const GRID_H = 80

export const Events = {
    GAME_START: 0,
    ROUND_START: 1,
    ROUND_END: 2,
    PLAYER_POSITIONS_UPDATE: 3,
    GAME_OVER: 4,
    TIMER_TICK: 5,
    READY_TO_HOST: 6,
    SELF_REACHED_TARGET: 7,
    SELF_LEFT_TARGET: 8,
    PLAYER_TELEPORTED: 9
} as const

export type EventType = typeof Events[keyof typeof Events]

export enum GuiEventType  {
    key_press = "key_press",
    game_configured = "game_configured",
    ready_to_host = "ready_to_host"
}

export const keyboardKeys = {
    UP: 1,
    DOWN: 2,
    LEFT: 3,
    RIGHT: 4
} as const

// GUI event payloads
export type KeyboardKey = typeof keyboardKeys[keyof typeof keyboardKeys]

/**
 * Key press event with player identification and timestamp
 * Used for both human and bot input through the same pipeline
 */
export class KeyPressEvent {
    readonly playerId: string
    readonly key: KeyboardKey
    readonly clientTimestamp: number

    constructor(playerId: string, key: KeyboardKey, clientTimestamp: number = Date.now()) {
        this.playerId = playerId
        this.key = key
        this.clientTimestamp = clientTimestamp
    }
}

export class GameConfig {
    botPlayers: BotPlayer[]
    roundDuration_ms: number
    playerSpeed: number
    constructor(botPlayers: BotPlayer[], roundDuration_ms: number, playerSpeed: number) {
        this.botPlayers = botPlayers
        this.roundDuration_ms = roundDuration_ms
        this.playerSpeed = playerSpeed
    }
}
// ============================================================================
// Core Classes
// ============================================================================

export class Position {
    x: number
    y: number

    constructor(x: number, y: number) {
        this.x = x
        this.y = y
    }
}

export class Player {
    readonly id: string
    readonly name: string
    position: Position
    alive: boolean
    readonly color: number

    constructor(id: string, name: string, position: Position, color: number) {
        this.id = id
        this.name = name
        this.position = position
        this.alive = true
        this.color = color
    }
}

export class BotPlayer extends Player {
    expertiseLevel: number
    constructor(id: string, name: string, position: Position, color: number, expertiseLevel: number) {
        super(id, name, position, color)
        this.expertiseLevel = expertiseLevel
    }
}

export class Round {
    readonly number: number
    readonly duration: number
    time_left: number
    readonly players: Player[]
    readonly target: Position

    constructor(number: number, duration: number, players: Player[], target: Position) {
        this.number = number
        this.duration = duration
        this.time_left = duration
        this.players = players
        this.target = target
    }
}

export class Wormhole {
    readonly id: string
    readonly entrance: Position
    readonly exit: Position
    readonly color: number

    constructor(id: string, entrance: Position, exit: Position, color: number) {
        this.id = id
        this.entrance = entrance
        this.exit = exit
        this.color = color
    }
}

// ============================================================================
// Event Payloads
// ============================================================================

export class Evt_GameStart {
    readonly players: Player[]

    constructor(duration: number, players: Player[]) {
        this.players = players
    }
}

export class Evt_RoundStart {
    readonly round: number
    readonly duration: number
    readonly players: Player[]
    readonly target: Position
    readonly wormholes: Wormhole[]

    constructor(round: number, duration: number, players: Player[], target: Position, wormholes: Wormhole[]) {
        this.round = round
        this.duration = duration
        this.players = players
        this.target = target
        this.wormholes = wormholes
    }
}

export class RoundSummary {
    readonly round_number: number
    readonly eliminated_player: Player | null

    constructor(round_number: number, eliminated_player: Player | null) {
        this.round_number = round_number
        this.eliminated_player = eliminated_player
    }
}

export class Evt_RoundEnd {
    readonly roundSummary: RoundSummary

    constructor(roundSummary: RoundSummary) {
        this.roundSummary = roundSummary
    }
}

export class GameSummary {
    readonly total_rounds: number
    readonly players: Player[]
    readonly winner: Player

    constructor(total_rounds: number, players: Player[], winner: Player) {
        this.total_rounds = total_rounds
        this.players = players
        this.winner = winner
    }
}

export class Evt_GameOver {
    readonly game_summary: GameSummary

    constructor(game_summary: GameSummary) {
        this.game_summary = game_summary
    }
}

export class Evt_PlayerPositionsUpdate {
    readonly players: Player[]

    constructor(players: Player[]) {
        this.players = players
    }
}

export class Evt_TimerTick {
    readonly time_left: number

    constructor(time_left: number) {
        this.time_left = time_left
    }
}

export class Evt_SelfReachedTarget {
    readonly player: Player

    constructor(player: Player) {
        this.player = player
    }
}

export class Evt_SelfLeftTarget {
    readonly player: Player

    constructor(player: Player) {
        this.player = player
    }
}

export class Evt_PlayerTeleported {
    readonly player: Player
    readonly wormhole: Wormhole

    constructor(player: Player, wormhole: Wormhole) {
        this.player = player
        this.wormhole = wormhole
    }
}
// ============================================================================
// Game Event payloads
// ============================================================================

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


export type GUIEventPayload = KeyboardKey | KeyPressEvent | GameConfig
export type GameEvtHandler = (event: EventType, payload?: GameEventPayload) => void
export type TargetGenerator = () => Position

// Re-export TargetSelector types from TargetSelectors module
export type { TargetSelector, TargetSelectorContext } from './TargetSelectors.js'

export type WormholeGenerator = (
    gridWidth: number,
    gridHeight: number,
    target: Position,
    players: Player[]
) => Wormhole[]

/**
 * Constraints for wormhole generation.
 * Only includes fields that are actively used in the generation algorithm.
 */
export type WormHoleConstraints = {
    /** Maximum Manhattan distance from entrance to any player */
    maxDistanceFromPlayers: number
    /** Maximum Manhattan distance from exit to target */
    maxDistanceToTarget: number
    /** Minimum Manhattan distance between entrance and exit */
    lengthMin: number
    /** Maximum Manhattan distance between entrance and exit */
    lengthMax: number
}

/**
 * Default wormhole constraints
 */
const DEFAULT_WORMHOLE_CONSTRAINTS: WormHoleConstraints = {
    maxDistanceFromPlayers: 10,
    maxDistanceToTarget: 15,
    lengthMin: 5,
    lengthMax: 40,
}

/**
 * Validation error for wormhole constraints
 */
export class WormholeConstraintError extends Error {
    constructor(message: string) {
        super(`Invalid WormholeConstraints: ${message}`)
        this.name = 'WormholeConstraintError'
    }
}

/**
 * Factory function to create validated WormHoleConstraints.
 * Merges provided config with defaults and validates interdependent rules.
 * 
 * @param config - Partial constraints to override defaults
 * @returns Validated WormHoleConstraints
 * @throws WormholeConstraintError if constraints are invalid
 */
export function createWormholeConstraints(config: Partial<WormHoleConstraints> = {}): WormHoleConstraints {
    const constraints: WormHoleConstraints = {
        ...DEFAULT_WORMHOLE_CONSTRAINTS,
        ...config
    }

    // Validate non-negative values
    const fields: (keyof WormHoleConstraints)[] = [
        'maxDistanceFromPlayers',
        'maxDistanceToTarget',
        'lengthMin',
        'lengthMax'
    ]
    
    for (const field of fields) {
        if (constraints[field] < 0) {
            throw new WormholeConstraintError(`${field} must be >= 0, got ${constraints[field]}`)
        }
    }

    // Validate interdependent constraints
    if (constraints.lengthMin > constraints.lengthMax) {
        throw new WormholeConstraintError(
            `lengthMin (${constraints.lengthMin}) must be <= lengthMax (${constraints.lengthMax})`
        )
    }

    // Validate sensible ranges
    if (constraints.maxDistanceFromPlayers < 1) {
        throw new WormholeConstraintError(
            `maxDistanceFromPlayers must be >= 1, got ${constraints.maxDistanceFromPlayers}`
        )
    }

    if (constraints.maxDistanceToTarget < 1) {
        throw new WormholeConstraintError(
            `maxDistanceToTarget must be >= 1, got ${constraints.maxDistanceToTarget}`
        )
    }

    return constraints
}