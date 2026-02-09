// ============================================================================
// Movement Strategies - Injectable behaviors for player movement
// ============================================================================

import { GRID_W, GRID_H, Player, Position, KeyboardKey, keyboardKeys } from "./GlobalGameReference.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Context provided to speed providers for calculating player speed
 */
export interface SpeedContext {
    roundNumber: number
    tickNumber: number
    // Future: terrain type, power-ups, etc.
}

/**
 * Function type for speed providers
 * Returns the speed multiplier for a player (1.0 = normal, 0.5 = half speed, 2.0 = double)
 */
export type SpeedProvider = (player: Player, context: SpeedContext) => number

/**
 * Context provided to move resolvers for determining final position
 */
export interface MoveContext {
    gridWidth: number
    gridHeight: number
    // Future: obstacles, other players, etc.
}

/**
 * Direction vector from keyboard input
 */
export interface Direction {
    dx: -1 | 0 | 1
    dy: -1 | 0 | 1
}

/**
 * Function type for move resolvers
 * Given a player and direction, returns the new position (or null if move is blocked)
 */
export type MoveResolver = (
    player: Player,
    direction: Direction,
    context: MoveContext
) => Position | null

/**
 * Per-player movement state for accumulator pattern
 */
export interface PlayerMovementState {
    accumulator: number
    lastProcessedTick: number
}

/**
 * Configuration for the movement controller
 */
export interface MovementConfig {
    tickIntervalMs: number      // Motion tick interval (25-50ms typical)
    maxAccumulatedMoves: number // Cap on accumulator (1-2 typical)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert keyboard key to direction vector
 */
export function keyToDirection(key: KeyboardKey): Direction {
    switch (key) {
        case keyboardKeys.UP:
            return { dx: 0, dy: -1 }
        case keyboardKeys.DOWN:
            return { dx: 0, dy: 1 }
        case keyboardKeys.LEFT:
            return { dx: -1, dy: 0 }
        case keyboardKeys.RIGHT:
            return { dx: 1, dy: 0 }
        default:
            return { dx: 0, dy: 0 }
    }
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

// ============================================================================
// Speed Provider Implementations
// ============================================================================

/**
 * Constant speed - all players move at same rate
 */
export function createConstantSpeedProvider(speedMultiplier: number = 1.0): SpeedProvider {
    return (_player: Player, _context: SpeedContext): number => {
        return speedMultiplier
    }
}

/**
 * Progressive speed - speed increases with round number
 */
export function createProgressiveSpeedProvider(
    baseSpeed: number = 1.0,
    maxSpeed: number = 2.0,
    totalRounds: number = 10
): SpeedProvider {
    return (_player: Player, context: SpeedContext): number => {
        const progress = Math.min(context.roundNumber / totalRounds, 1)
        return baseSpeed + (maxSpeed - baseSpeed) * progress
    }
}

/**
 * Per-player speed - allows individual player speed customization
 * Uses a map of player ID to speed multiplier
 */
export function createPerPlayerSpeedProvider(
    playerSpeeds: Map<string, number>,
    defaultSpeed: number = 1.0
): SpeedProvider {
    return (player: Player, _context: SpeedContext): number => {
        return playerSpeeds.get(player.id) ?? defaultSpeed
    }
}

// ============================================================================
// Move Resolver Implementations
// ============================================================================

/**
 * Simple grid move - clamps to grid boundaries
 */
export function simpleMoveResolver(
    player: Player,
    direction: Direction,
    context: MoveContext
): Position | null {
    const newX = clamp(player.position.x + direction.dx, 0, context.gridWidth - 1)
    const newY = clamp(player.position.y + direction.dy, 0, context.gridHeight - 1)
    return new Position(newX, newY)
}

/**
 * Wrapping move - wraps around grid edges
 */
export function wrappingMoveResolver(
    player: Player,
    direction: Direction,
    context: MoveContext
): Position | null {
    let newX = player.position.x + direction.dx
    let newY = player.position.y + direction.dy
    
    // Wrap around
    if (newX < 0) newX = context.gridWidth - 1
    if (newX >= context.gridWidth) newX = 0
    if (newY < 0) newY = context.gridHeight - 1
    if (newY >= context.gridHeight) newY = 0
    
    return new Position(newX, newY)
}

/**
 * Blocking move - prevents movement if at boundary (returns null)
 */
export function blockingMoveResolver(
    player: Player,
    direction: Direction,
    context: MoveContext
): Position | null {
    const newX = player.position.x + direction.dx
    const newY = player.position.y + direction.dy
    
    // Block if out of bounds
    if (newX < 0 || newX >= context.gridWidth || newY < 0 || newY >= context.gridHeight) {
        return null
    }
    
    return new Position(newX, newY)
}

// ============================================================================
// Movement Controller
// ============================================================================

/**
 * Manages tick-based movement with accumulator pattern
 * This class handles the core movement logic, using injectable SpeedProvider and MoveResolver
 */
export class MovementController {
    private readonly config: MovementConfig
    private readonly speedProvider: SpeedProvider
    private readonly moveResolver: MoveResolver
    private readonly playerStates: Map<string, PlayerMovementState> = new Map()
    private currentTick: number = 0
    private readonly inputBuffer: Map<string, { key: KeyboardKey, clientTick: number }> = new Map()

    constructor(
        config: MovementConfig,
        speedProvider: SpeedProvider,
        moveResolver: MoveResolver
    ) {
        this.config = config
        this.speedProvider = speedProvider
        this.moveResolver = moveResolver
    }

    /**
     * Initialize movement state for a player
     */
    initPlayer(playerId: string): void {
        this.playerStates.set(playerId, {
            accumulator: 0,
            lastProcessedTick: -1
        })
    }

    /**
     * Remove a player's movement state
     */
    removePlayer(playerId: string): void {
        this.playerStates.delete(playerId)
        this.inputBuffer.delete(playerId)
    }

    /**
     * Buffer an input for a player (first-wins per tick)
     * @param playerId Player who sent the input
     * @param key The keyboard key pressed
     * @param clientTimestamp Client-side timestamp of the input
     * @param clockOffset Offset to convert client time to server time
     * @param gameStartTime When the game started (for tick calculation)
     */
    bufferInput(
        playerId: string,
        key: KeyboardKey,
        clientTimestamp: number,
        clockOffset: number,
        gameStartTime: number
    ): void {
        const adjustedTime = clientTimestamp + clockOffset
        const inputTick = Math.floor((adjustedTime - gameStartTime) / this.config.tickIntervalMs)
        
        const existing = this.inputBuffer.get(playerId)
        
        // First-wins: only accept if no input for this tick or earlier tick
        if (!existing || inputTick < existing.clientTick) {
            this.inputBuffer.set(playerId, { key, clientTick: inputTick })
        }
        // If same tick and already have input, discard (first-wins)
    }

    /**
     * Process a motion tick for all players
     * Returns list of players whose positions changed
     */
    processTick(
        players: Player[],
        roundNumber: number,
        moveContext: MoveContext
    ): Player[] {
        this.currentTick++
        const movedPlayers: Player[] = []
        
        const speedContext: SpeedContext = {
            roundNumber,
            tickNumber: this.currentTick
        }

        for (const player of players) {
            let state = this.playerStates.get(player.id)
            if (!state) {
                this.initPlayer(player.id)
                state = this.playerStates.get(player.id)!
            }

            // Accumulate speed
            const speed = this.speedProvider(player, speedContext)
            state.accumulator = Math.min(
                state.accumulator + speed,
                this.config.maxAccumulatedMoves
            )

            // Check for buffered input
            const bufferedInput = this.inputBuffer.get(player.id)
            if (bufferedInput && state.accumulator >= 1.0) {
                const direction = keyToDirection(bufferedInput.key)
                const newPosition = this.moveResolver(player, direction, moveContext)
                
                if (newPosition) {
                    player.position = newPosition
                    movedPlayers.push(player)
                }
                
                state.accumulator -= 1.0
                state.lastProcessedTick = this.currentTick
                this.inputBuffer.delete(player.id)
            }
        }

        return movedPlayers
    }

    /**
     * Get current tick number
     */
    getCurrentTick(): number {
        return this.currentTick
    }

    /**
     * Reset controller state (for new round)
     */
    reset(): void {
        this.currentTick = 0
        this.playerStates.clear()
        this.inputBuffer.clear()
    }

    /**
     * Update speed for a specific player at runtime
     */
    setPlayerSpeed(playerId: string, speedMultiplier: number): void {
        // This is handled by the SpeedProvider - for per-player speed,
        // use createPerPlayerSpeedProvider and update the map externally
    }
}

// ============================================================================
// Default Exports - Commonly used strategies
// ============================================================================

export const SpeedProviders = {
    constant: createConstantSpeedProvider(),
    fast: createConstantSpeedProvider(1.5),
    slow: createConstantSpeedProvider(0.5),
    progressive: createProgressiveSpeedProvider()
}

export const MoveResolvers = {
    simple: simpleMoveResolver,
    wrapping: wrappingMoveResolver,
    blocking: blockingMoveResolver
}

export const DefaultMovementConfig: MovementConfig = {
    tickIntervalMs: 40,        // 25 ticks per second
    maxAccumulatedMoves: 2     // Allow slight buffer
}
