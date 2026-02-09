// ============================================================================
// BotClient - Autonomous bot player that sends input through the same pipeline as human
// ============================================================================

import {
    Events,
    EventType,
    GameEventPayload,
    Evt_RoundStart,
    Evt_RoundEnd,
    Evt_GameOver,
    Evt_PlayerPositionsUpdate,
    Player,
    BotPlayer,
    Position,
    KeyPressEvent,
    KeyboardKey,
    keyboardKeys,
    GuiEventType,
    GUIEventPayload
} from "./GlobalGameReference.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Function to send GUI events (key presses) to the network layer
 */
export type GuiEventSender = (evtType: string, evtData?: GUIEventPayload) => void

/**
 * Bot AI strategy - decides which direction to move
 * Returns a keyboard key or null if no move should be made
 */
export type BotAI = (
    botPosition: Position,
    targetPosition: Position,
    allPlayerPositions: Map<string, Position>
) => KeyboardKey | null

// ============================================================================
// Built-in Bot AI Strategies
// ============================================================================

/**
 * Simple AI: Move toward target with occasional random moves
 * @param randomChance Probability of making a random move (0-1)
 */
export function createSimpleBotAI(randomChance: number = 0.1): BotAI {
    return (botPosition: Position, targetPosition: Position, _allPlayerPositions: Map<string, Position>): KeyboardKey | null => {
        // Random move chance
        if (Math.random() < randomChance) {
            const directions: KeyboardKey[] = [
                keyboardKeys.UP,
                keyboardKeys.DOWN,
                keyboardKeys.LEFT,
                keyboardKeys.RIGHT
            ]
            return directions[Math.floor(Math.random() * directions.length)]
        }

        // Check if already at target
        const dx = targetPosition.x - botPosition.x
        const dy = targetPosition.y - botPosition.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance <= 1) {
            // Already at target, no move needed
            return null
        }

        // Move toward target
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? keyboardKeys.RIGHT : keyboardKeys.LEFT
        } else {
            return dy > 0 ? keyboardKeys.DOWN : keyboardKeys.UP
        }
    }
}

/**
 * Aggressive AI: Always moves toward target, no random moves
 */
export const aggressiveBotAI: BotAI = createSimpleBotAI(0)

/**
 * Erratic AI: High random chance, less predictable
 */
export const erraticBotAI: BotAI = createSimpleBotAI(0.3)

/**
 * Lazy AI: Moves slowly, high chance of not moving
 */
export function createLazyBotAI(skipChance: number = 0.5): BotAI {
    const simpleAI = createSimpleBotAI(0.1)
    return (botPosition: Position, targetPosition: Position, allPlayerPositions: Map<string, Position>): KeyboardKey | null => {
        if (Math.random() < skipChance) {
            return null // Skip this move
        }
        return simpleAI(botPosition, targetPosition, allPlayerPositions)
    }
}

// ============================================================================
// BotClient Class
// ============================================================================

/**
 * BotClient - Represents a single bot player
 * Receives game events from ClientNW and sends key presses back
 * Operates at the same layer as GameRenderer
 */
export class BotClient {
    private readonly botPlayer: BotPlayer
    private readonly sendGuiEvent: GuiEventSender
    private readonly botAI: BotAI
    private readonly thinkIntervalMs: number

    private currentTarget: Position | null = null
    private playerPositions: Map<string, Position> = new Map()
    private thinkTimer: ReturnType<typeof setInterval> | null = null
    private isRoundActive: boolean = false

    /**
     * Create a new BotClient
     * @param botPlayer The bot player this client controls
     * @param sendGuiEvent Function to send GUI events to the network layer
     * @param botAI AI strategy to use (defaults to simple AI)
     * @param thinkIntervalMs How often the bot "thinks" (ms between decisions)
     */
    constructor(
        botPlayer: BotPlayer,
        sendGuiEvent: GuiEventSender,
        botAI: BotAI = createSimpleBotAI(),
        thinkIntervalMs: number = 60
    ) {
        this.botPlayer = botPlayer
        this.sendGuiEvent = sendGuiEvent
        this.botAI = botAI
        this.thinkIntervalMs = thinkIntervalMs
    }

    /**
     * Get the bot player this client controls
     */
    getPlayer(): BotPlayer {
        return this.botPlayer
    }

    /**
     * Handle incoming game events
     * This should be registered with ClientNW.gameEventEmitter
     */
    onGameEvt(type: EventType, payload?: GameEventPayload): void {
        switch (type) {
            case Events.ROUND_START:
                this.handleRoundStart(payload as Evt_RoundStart)
                break
            case Events.ROUND_END:
                this.handleRoundEnd()
                break
            case Events.GAME_OVER:
                this.handleGameOver()
                break
            case Events.PLAYER_POSITIONS_UPDATE:
                this.handlePositionsUpdate(payload as Evt_PlayerPositionsUpdate)
                break
        }
    }

    private handleRoundStart(evt: Evt_RoundStart): void {
        this.currentTarget = evt.target
        this.isRoundActive = true

        // Update initial positions
        evt.players.forEach(player => {
            this.playerPositions.set(player.id, new Position(player.position.x, player.position.y))
        })

        // Start thinking
        this.startThinking()
    }

    private handleRoundEnd(): void {
        this.isRoundActive = false
        this.stopThinking()
    }

    private handleGameOver(): void {
        this.isRoundActive = false
        this.stopThinking()
        this.currentTarget = null
    }

    private handlePositionsUpdate(evt: Evt_PlayerPositionsUpdate): void {
        evt.players.forEach(player => {
            this.playerPositions.set(player.id, new Position(player.position.x, player.position.y))
        })
    }

    private startThinking(): void {
        this.stopThinking() // Clear any existing timer

        this.thinkTimer = setInterval(() => {
            this.think()
        }, this.thinkIntervalMs)
    }

    private stopThinking(): void {
        if (this.thinkTimer) {
            clearInterval(this.thinkTimer)
            this.thinkTimer = null
        }
    }

    /**
     * Bot decision-making - called periodically
     */
    private think(): void {
        if (!this.isRoundActive || !this.currentTarget) {
            return
        }

        // Get bot's current position
        const myPosition = this.playerPositions.get(this.botPlayer.id)
        if (!myPosition) {
            return
        }

        // Ask AI what to do
        const direction = this.botAI(myPosition, this.currentTarget, this.playerPositions)

        if (direction !== null) {
            // Send key press through the same pipeline as human input
            const keyPressEvent = new KeyPressEvent(
                this.botPlayer.id,
                direction,
                Date.now()
            )
            this.sendGuiEvent(GuiEventType.key_press, keyPressEvent)
        }
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.stopThinking()
    }
}

// ============================================================================
// Default Exports
// ============================================================================

export const BotAIs = {
    simple: createSimpleBotAI(),
    aggressive: aggressiveBotAI,
    erratic: erraticBotAI,
    lazy: createLazyBotAI()
}
