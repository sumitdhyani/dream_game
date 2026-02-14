import { FSM, State, SubState, SpecialTransition, Logger, Transition, UnhandledEvtException, SpecialTransitionValue } from './FSM.js'
import {
    GRID_W,
    GRID_H,
    Events,
    GameSummary,
    keyboardKeys,
    Position,
    RoundSummary,
    Wormhole,
    Evt_GameStart,
    Evt_RoundStart,
    Evt_RoundEnd,
    Evt_GameOver,
    Evt_TimerTick,
    Evt_PlayerPositionsUpdate,
    Evt_SelfReachedTarget,
    Evt_SelfLeftTarget,
    Evt_PlayerTeleported,
    Player,
    GameEvtHandler,
    GameEventPayload,
    TargetGenerator,
    KeyboardKey,
    KeyPressEvent,
    EventType,
    GameConfig,
    BotPlayer,
    GuiEventType,
    GUIEventPayload,
    WormholeGenerator
} from "./GlobalGameReference.js"
import { TargetSelector, TargetSelectorContext } from './TargetSelectors.js'

// ============================================================================
// GameEngineFSM - Main FSM for game logic
// ============================================================================

/** Union of all game event payload types */
export type GameEvent = GameEventPayload

function propagateGameEvt(logger: Logger, gameEvtHandler: GameEvtHandler, type: EventType, evtData?: GameEventPayload) : void {
    gameEvtHandler(type, evtData)
}

export class GameEngineFSM extends FSM<GUIEventPayload, undefined> {
    constructor(
        gameEvtHandler: GameEvtHandler,
        targetSelector: TargetSelector,
        wormholeGenerator: WormholeGenerator,
        logger: Logger
    ) {
        const initState = new PreStart(
            gameEvtHandler,
            targetSelector,
            null!,  // Will be set after super()
            wormholeGenerator,
            logger
        )
        super(() => initState, logger)

        initState.selfFsm = this
    }

    onUnconsumedEvt(exception: UnhandledEvtException): void {
        this.logger.warn(`Unconsumed evt, errMessage: ${exception.message}`)
    }
}

// ============================================================================
// PreStart State
// ============================================================================

class PreStart extends State<GUIEventPayload, undefined> {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly targetSelector: TargetSelector
    private readonly logger: Logger
    private readonly wormholeGenerator: WormholeGenerator
    selfFsm!: GameEngineFSM

    constructor(
        gameEvtHandler: GameEvtHandler,
        targetSelector: TargetSelector,
        selfFsm: GameEngineFSM,
        wormholeGenerator: WormholeGenerator,
        logger: Logger
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.targetSelector = targetSelector
        this.selfFsm = selfFsm
        this.wormholeGenerator = wormholeGenerator
        this.logger = logger
    }

    onEntry(): void {
        propagateGameEvt(this.logger, this.gameEvtHandler, Events.GAME_START);
    }

    on_game_configured(gameConfig: GameConfig): PlayingRound {
        const allPlayers: Player[] = gameConfig.botPlayers
        const self: Player = new Player("self_id", "You", new Position(0, 0), 0xff0000)
        allPlayers.push(self)
        const activePlayers = Array.from<Player>(allPlayers)
        const eliminatedPlayers: Player[] = []

        // Generate initial target using selector with initial context
        const initialContext: TargetSelectorContext = {
            activePlayers,
            eliminatedPlayer: null,
            roundNumber: 1,
            previousTarget: null
        }
        const initialTarget = this.targetSelector(initialContext)

        return new PlayingRound(
            this.gameEvtHandler,
            allPlayers,
            activePlayers,
            eliminatedPlayers,
            self,
            this.targetSelector,
            gameConfig.roundDuration_ms,
            this.selfFsm,
            1,
            gameConfig.playerSpeed,
            initialTarget,
            this.wormholeGenerator,
            this.logger)

    }
}

// ============================================================================
// PlayingRound State
// ============================================================================

/**
 * PlayingRound - State with SubState support
 * Handles normal gameplay events directly (on_key_press, on_round_end)
 * Transitions to TeleportingSubState when wormhole is used
 */
class PlayingRound extends State<GUIEventPayload, undefined> {
    private gameEvtHandler: GameEvtHandler
    private readonly players: Player[]
    private readonly activePlayers: Player[]
    private readonly eliminatedPlayers: Player[]
    private readonly self: Player
    private readonly targetSelector: TargetSelector
    private readonly roundLength: number
    private timeLeft: number
    private timerId: ReturnType<typeof setInterval> | null
    private readonly selfFsm: GameEngineFSM
    private readonly wormholeGenerator: WormholeGenerator
    private readonly roundNo: number
    private readonly moveDelay: number
    private readonly target: Position
    private readonly wormholes: Wormhole[]
    private readonly lastMoveTimes: Record<string, number>
    private selfReachedTarget: boolean
    private readonly logger: Logger

    constructor(
        gameEvtHandler: GameEvtHandler,
        players: Player[],
        activePlayers: Player[],
        eliminatedPlayers: Player[],
        self: Player,
        targetSelector: TargetSelector,
        roundLength: number,
        selfFsm: GameEngineFSM,
        roundNo: number,
        moveDelay: number,
        target: Position,
        wormholeGenerator: WormholeGenerator,
        logger: Logger)
    {
        super()
        this.logger = logger
        this.players = players
        this.activePlayers = activePlayers
        this.self = self
        this.eliminatedPlayers = eliminatedPlayers
        this.targetSelector = targetSelector
        this.roundLength = roundLength
        this.timeLeft = roundLength
        this.timerId = null
        this.selfFsm = selfFsm
        this.roundNo = roundNo
        this.moveDelay = moveDelay
        this.target = target
        this.wormholeGenerator = wormholeGenerator

        this.gameEvtHandler = gameEvtHandler
        this.lastMoveTimes = {}
        this.selfReachedTarget = false
        this.activePlayers.forEach((player) => {
            this.lastMoveTimes[player.id] = 0
        })

        this.wormholes = wormholeGenerator(GRID_W, GRID_H, this.target, this.activePlayers)
        this.wormholes.forEach((wormhole, idx) => {
            this.logger.info(`Generated wormhole ${idx}: entrance (${wormhole.entrance.x}, ${wormhole.entrance.y}) -> exit (${wormhole.exit.x}, ${wormhole.exit.y})`)
        })
    }

    registerForGameEvts(gameEvtHandler: GameEvtHandler) {
        this.gameEvtHandler = gameEvtHandler
    }

    onEntry(): void {
        console.log(`200`)
          propagateGameEvt(this.logger, this.gameEvtHandler, Events.ROUND_START, new Evt_RoundStart(
                this.roundNo,
                this.roundLength,
                this.activePlayers,
                this.target,
                this.wormholes
          ))

        this.timerId = setInterval(() => {
            if (this.timeLeft > 0) {
                this.timeLeft -= 1000
                propagateGameEvt(this.logger, this.gameEvtHandler, Events.TIMER_TICK, new Evt_TimerTick(this.timeLeft))
            } else {
                setTimeout(() => {
                    console.log(`Signalling round end`)
                    this.selfFsm.handleEvent("round_end")
                }, 0)
            }
        }, 1000)

    }

    on_key_press(keyPressEvent: KeyPressEvent): TeleportingSubState | null | undefined{
        // Find the player by ID
        const player = this.activePlayers.find(p => p.id === keyPressEvent.playerId)
        if (!player || !player.alive) {
            return
        }

        // Throttle check per player
        if (Date.now() - this.lastMoveTimes[player.id] < this.moveDelay) {
            return
        }

        const key = keyPressEvent.key
        switch (key) {
            case keyboardKeys.UP:
                player.position.y--
                break
            case keyboardKeys.DOWN:
                player.position.y++
                break
            case keyboardKeys.LEFT:
                player.position.x--
                break
            case keyboardKeys.RIGHT:
                player.position.x++
                break
        }

        // Clamp to grid boundaries
        player.position.x = Math.max(0, Math.min(GRID_W - 1, player.position.x))
        player.position.y = Math.max(0, Math.min(GRID_H - 1, player.position.y))

        this.lastMoveTimes[player.id] = Date.now()
        propagateGameEvt(this.logger, this.gameEvtHandler, Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))

        // Check for wormhole teleport (only for self player for now)
        if (player.id === this.self.id) {
            const teleportState = this.checkWormholeTeleport()
            if (teleportState) {
                return teleportState
            }

            this.checkSelfReachedTarget()
            this.checkSelfLeftTarget()
        }
    }

    private checkWormholeTeleport(): TeleportingSubState | null {
        const wormhole = this.wormholes.find(w =>
            w.entrance.x === this.self.position.x &&
            w.entrance.y === this.self.position.y
        )

        if (wormhole) {
            return new TeleportingSubState(this, this.selfFsm, this.self, wormhole, this.gameEvtHandler)
        }

        return null
    }

    onResumeFromSubstate(_payload: undefined): void {
        // Teleport complete - check if player reached target after teleport
        this.checkSelfReachedTarget()
        this.checkSelfLeftTarget()
    }

    private checkSelfReachedTarget(): void {
        if (!this.selfReachedTarget && this.isPlayerAtTarget(this.self)) {
            this.selfReachedTarget = true
            propagateGameEvt(this.logger, this.gameEvtHandler, Events.SELF_REACHED_TARGET, new Evt_SelfReachedTarget(this.self))
        }
    }

    private checkSelfLeftTarget(): void {
        if (this.selfReachedTarget && !this.isPlayerAtTarget(this.self)) {
            this.selfReachedTarget = false
            propagateGameEvt(this.logger, this.gameEvtHandler, Events.SELF_LEFT_TARGET, new Evt_SelfLeftTarget(this.self))
        }
    }

    beforeExit(): void {
        if (this.timerId) clearInterval(this.timerId)
    }

    on_round_end(): RoundEnded {
        return new RoundEnded(
            this.gameEvtHandler,
            this.players,
            this.activePlayers,
            this.self,
            this.eliminatedPlayers,
            this.targetSelector,
            this.roundLength,
            this.selfFsm,
            this.roundNo,
            this.target,
            this.moveDelay,
            this.wormholeGenerator,
            this.logger
        )
    }

    private isPlayerAtTarget(player: Player): boolean {
        const dx = player.position.x - this.target.x
        const dy = player.position.y - this.target.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        return distance <= 1
    }
}

// ============================================================================
// TeleportingSubState
// ============================================================================

class TeleportingSubState extends SubState<GUIEventPayload, undefined> {
    private readonly fsm: GameEngineFSM
    private readonly player: Player
    private readonly wormhole: Wormhole
    private readonly gameEvtHandler: GameEvtHandler
    private timerId: ReturnType<typeof setTimeout> | null
    
    constructor(
        parent: State<GUIEventPayload, undefined>,
        fsm: GameEngineFSM,
        player: Player,
        wormhole: Wormhole,
        gameEvtHandler: GameEvtHandler
    ) {
        super(parent)
        this.fsm = fsm
        this.player = player
        this.wormhole = wormhole
        this.gameEvtHandler = gameEvtHandler
        this.timerId = null
    }

    onEntry(): void {
        // Perform the teleportation
        this.player.position.x = this.wormhole.exit.x
        this.player.position.y = this.wormhole.exit.y

        // Notify renderer
        propagateGameEvt(this.fsm.logger, this.gameEvtHandler, Events.PLAYER_TELEPORTED, new Evt_PlayerTeleported(this.player, this.wormhole))

        // Start animation timer
        const TELEPORT_ANIMATION_DURATION = 600
        this.timerId = setTimeout(() => {
            this.fsm.handleEvent("teleport_complete")
        }, TELEPORT_ANIMATION_DURATION)
    }

    beforeExit(): void {
        if (this.timerId) clearTimeout(this.timerId)
    }

    on_key_press(_keyPressEvent: KeyPressEvent): SpecialTransitionValue {
        return SpecialTransition.deferralTransition
    }

    on_teleport_complete(): SpecialTransitionValue {
        return SpecialTransition.ReturnToParent
    }

    // on_round_end bubbles to parent via SubState.react()
}

// ============================================================================
// RoundEnded State
// ============================================================================

class RoundEnded extends State<GUIEventPayload, undefined> {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly players: Player[]
    private readonly activePlayers: Player[]
    private readonly self: Player
    private readonly eliminatedPlayers: Player[]
    private readonly targetSelector: TargetSelector
    private readonly roundLength: number
    private readonly selfFsm: GameEngineFSM
    private readonly roundNo: number
    private readonly target: Position
    private readonly moveDelay: number
    private readonly logger: Logger
    private readonly wormholeGenerator: WormholeGenerator
    private eliminatedPlayer: Player | null

    constructor(
        gameEvtHandler: GameEvtHandler,
        players: Player[],
        activePlayers: Player[],
        self: Player,
        eliminatedPlayers: Player[],
        targetSelector: TargetSelector,
        roundLength: number,
        selfFsm: GameEngineFSM,
        roundNo: number,
        target: Position,
        moveDelay: number,
        wormholeGenerator: WormholeGenerator,
        logger: Logger
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.players = players
        this.activePlayers = activePlayers
        this.self = self
        this.eliminatedPlayers = eliminatedPlayers
        this.targetSelector = targetSelector
        this.roundLength = roundLength
        this.selfFsm = selfFsm
        this.roundNo = roundNo
        this.target = target
        this.moveDelay = moveDelay
        this.wormholeGenerator = wormholeGenerator
        this.logger = logger
        this.eliminatedPlayer = null
    }

    private findFarthestPlayerIdxs(): number[] {
        console.log(`Active players: ${this.activePlayers.reduce((acc, player) => {
            return `${acc}|name: ${player.name}, pos: ${player.position.x}:${player.position.y}`
        }, "")}`)

        const distances = this.activePlayers.map((player, idx) => {
            const dx = player.position.x - this.target.x
            const dy = player.position.y - this.target.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            return { idx, distance }
        })

        const maxDistance = Math.max(...distances.map(d => d.distance))

        return distances
            .filter(d => d.distance === maxDistance)
            .map(d => d.idx)
    }

    private findLoserIdx(): number {
        const farthestPlayerIdxs = this.findFarthestPlayerIdxs()

        if (farthestPlayerIdxs.length === this.activePlayers.length) {
            return -1
        } else {
            return farthestPlayerIdxs[0]
        }
    }

    private eliminateLoser(): Player | null {
        const loserIdx = this.findLoserIdx()
        if (loserIdx === -1) {
            return null
        }

        console.log(`loserIdx: ${loserIdx}, activelayers: ${this.activePlayers.reduce((acc, player) => {
            return acc + " : " + player.name
        }, "")}`)

        const loserPlayer = this.activePlayers[loserIdx]
        loserPlayer.alive = false
        this.eliminatedPlayers.push(loserPlayer)
        this.activePlayers.splice(loserIdx, 1)
        return loserPlayer
    }

    on_launch(): GameOver | void {
        this.eliminatedPlayer = this.eliminateLoser()

        if (this.activePlayers.length === 1) {
            const winner_player = this.activePlayers[0]
            return new GameOver(this.gameEvtHandler, this.roundNo, this.players, winner_player, this.logger)
        }

        const roundSummary = new RoundSummary(this.roundNo, this.eliminatedPlayer)
        propagateGameEvt(this.logger, this.gameEvtHandler, Events.ROUND_END, new Evt_RoundEnd(roundSummary))
        return
    }

    on_ready_to_host(): PlayingRound {
        // Build context for target selector
        const context: TargetSelectorContext = {
            activePlayers: this.activePlayers,
            eliminatedPlayer: this.eliminatedPlayer,
            roundNumber: this.roundNo + 1,
            previousTarget: this.target
        }
        
        const newTarget = this.targetSelector(context)
        
        return new PlayingRound(
            this.gameEvtHandler,
            this.players,
            this.activePlayers,
            this.eliminatedPlayers,
            this.self,
            this.targetSelector,
            this.roundLength,
            this.selfFsm,
            this.roundNo + 1,
            this.moveDelay,
            newTarget,
            this.wormholeGenerator,
            this.logger
        )
    }
}

// ============================================================================
// GameOver State
// ============================================================================

class GameOver extends State<GUIEventPayload, undefined> {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly roundNo: number
    private readonly players: Player[]
    private readonly winner_player: Player
    private readonly logger: Logger

    constructor(
        gameEvtHandler: GameEvtHandler,
        roundNo: number,
        players: Player[],
        winner_player: Player,
        logger: Logger
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.roundNo = roundNo
        this.players = players
        this.winner_player = winner_player
        this.logger = logger
    }

    onEntry(): void {
        const game_summary = new GameSummary(this.roundNo, this.players, this.winner_player)
        propagateGameEvt(this.logger, this.gameEvtHandler, Events.GAME_OVER, new Evt_GameOver(game_summary))
    }
}
