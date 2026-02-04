import { FSM, State, SubState, SpecialTransition, Logger, Transition, UnhandledEvtException } from './FSM.js'
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
    TargetGenerator,
    KeyboardKey
} from "./GlobalGameReference.js"

// ============================================================================
// GameEngineFSM - Main FSM for game logic
// ============================================================================

export class GameEngineFSM extends FSM {
    constructor(
        gameEvtHandler: GameEvtHandler,
        players: Player[],
        self: Player,
        targetGenerator: TargetGenerator,
        logger: Logger,
        moveDelay: number
    ) {
        const initState = new PreStart(
            gameEvtHandler,
            players,
            self,
            targetGenerator,
            null!,  // Will be set after super()
            moveDelay
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

class PreStart extends State {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly players: Player[]
    private readonly activePlayers: Player[]
    private readonly eliminatedPlayers: Player[]
    private readonly self: Player
    private readonly targetGenerator: TargetGenerator
    private readonly moveDelay: number
    selfFsm!: GameEngineFSM

    constructor(
        gameEvtHandler: GameEvtHandler,
        players: Player[],
        self: Player,
        targetGenerator: TargetGenerator,
        selfFsm: GameEngineFSM,
        moveDelay: number
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.players = players
        this.activePlayers = Array.from(players)
        this.eliminatedPlayers = []
        this.self = self
        this.targetGenerator = targetGenerator
        this.selfFsm = selfFsm
        this.moveDelay = moveDelay
    }

    onEntry(): void {
        setTimeout(() => {
            this.gameEvtHandler(Events.GAME_START, new Evt_GameStart(
                0, // timeToRoundEnd - not used in Evt_GameStart
                this.activePlayers
            ))
        }, 0)
    }

    on_ready_to_host(): Transition {
        return new PlayingRound(
            this.gameEvtHandler,
            this.players,
            this.activePlayers,
            this.eliminatedPlayers,
            this.self,
            this.targetGenerator,
            10000,
            this.selfFsm,
            1,
            this.moveDelay,
            this.targetGenerator(),
            this.selfFsm.logger
        )
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
class PlayingRound extends State {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly players: Player[]
    private readonly activePlayers: Player[]
    private readonly eliminatedPlayers: Player[]
    private readonly self: Player
    private readonly targetGenerator: TargetGenerator
    private readonly roundLength: number
    private timeLeft: number
    private timerId: ReturnType<typeof setInterval> | null
    private botTimerIds: ReturnType<typeof setInterval>[] | null
    private readonly selfFsm: GameEngineFSM
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
        targetGenerator: TargetGenerator,
        roundLength: number,
        selfFsm: GameEngineFSM,
        roundNo: number,
        moveDelay: number,
        target: Position,
        logger: Logger
    ) {
        super()
        this.logger = logger
        this.gameEvtHandler = gameEvtHandler
        this.players = players
        this.activePlayers = activePlayers
        this.self = self
        this.eliminatedPlayers = eliminatedPlayers
        this.targetGenerator = targetGenerator
        this.roundLength = roundLength
        this.timeLeft = roundLength
        this.timerId = null
        this.botTimerIds = null
        this.selfFsm = selfFsm
        this.roundNo = roundNo
        this.moveDelay = moveDelay
        this.target = target
        this.wormholes = []

        this.lastMoveTimes = {}
        this.selfReachedTarget = false
        this.activePlayers.forEach((player) => {
            this.lastMoveTimes[player.id] = 0
        })

        this.generateWormholes()
    }

    private generateWormholes(): void {
        const colors = [0x00ffff, 0x00ff00, 0xff00ff, 0xffff00]
        const wormholeCount = 3

        for (let i = 0; i < wormholeCount; i++) {
            let entrance!: Position
            let exit!: Position
            let valid = false

            while (!valid) {
                entrance = new Position(
                    Math.floor(Math.random() * GRID_W),
                    Math.floor(Math.random() * GRID_H)
                )
                if (entrance.x === this.target.x && entrance.y === this.target.y) continue
                const onPlayer = this.activePlayers.some(p =>
                    p.position.x === entrance.x && p.position.y === entrance.y
                )
                if (onPlayer) continue
                const overlaps = this.wormholes.some(w =>
                    w.entrance.x === entrance.x && w.entrance.y === entrance.y
                )
                if (overlaps) continue
                valid = true
            }

            valid = false
            while (!valid) {
                exit = new Position(
                    Math.floor(Math.random() * GRID_W),
                    Math.floor(Math.random() * GRID_H)
                )
                if (exit.x === this.target.x && exit.y === this.target.y) continue
                const overlaps = this.wormholes.some(w =>
                    (w.entrance.x === exit.x && w.entrance.y === exit.y) ||
                    (w.exit.x === exit.x && w.exit.y === exit.y)
                )
                if (overlaps) continue
                if (exit.x === entrance.x && exit.y === entrance.y) continue
                valid = true
            }

            const wormhole = new Wormhole(`wh_${i}`, entrance, exit, colors[i % colors.length])
            this.wormholes.push(wormhole)
            this.wormholes.forEach(w => {
                console.log(`Wormhole ${w.id}: entrance (${w.entrance.x}, ${w.entrance.y}) -> exit (${w.exit.x}, ${w.exit.y})`)
            })
        }

        console.log(`Generated ${this.wormholes.length} wormholes`)
    }

    onEntry(): void {
        console.log(`200`)
        this.gameEvtHandler(Events.ROUND_START,
            new Evt_RoundStart(
                this.roundNo,
                this.roundLength,
                this.activePlayers,
                this.target,
                this.wormholes
            ))

        this.timerId = setInterval(() => {
            if (this.timeLeft > 0) {
                this.timeLeft -= 1000
                this.gameEvtHandler(Events.TIMER_TICK, new Evt_TimerTick(this.timeLeft))
            } else {
                setTimeout(() => {
                    console.log(`Signalling round end`)
                    this.selfFsm.handleEvent("round_end")
                }, 0)
            }
        }, 1000)

        const botPlayers = this.activePlayers.filter((player) => {
            return player.id !== this.self.id
        })

        this.botTimerIds = botPlayers.map((botPlayer) => {
            return setInterval(() => {
                this.moveBot(botPlayer, this.target)
            }, 60)
        })
    }

    on_key_press(key: KeyboardKey): Transition {
        if (!this.self.alive ||
            Date.now() - this.lastMoveTimes[this.self.id] < this.moveDelay) {
            return
        }

        switch (key) {
            case keyboardKeys.UP:
                this.self.position.y--
                break
            case keyboardKeys.DOWN:
                this.self.position.y++
                break
            case keyboardKeys.LEFT:
                this.self.position.x--
                break
            case keyboardKeys.RIGHT:
                this.self.position.x++
                break
        }

        this.lastMoveTimes[this.self.id] = Date.now()
        this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))

        const teleportState = this.checkWormholeTeleport()
        if (teleportState) {
            return teleportState
        }

        this.checkSelfReachedTarget()
        this.checkSelfLeftTarget()
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

    onResumeFromSubstate(payload: unknown): void {
        // Teleport complete - check if player reached target after teleport
        this.checkSelfReachedTarget()
        this.checkSelfLeftTarget()
    }

    private checkSelfReachedTarget(): void {
        if (!this.selfReachedTarget && this.isPlayerAtTarget(this.self)) {
            this.selfReachedTarget = true
            this.gameEvtHandler(Events.SELF_REACHED_TARGET, new Evt_SelfReachedTarget(this.self))
        }
    }

    private checkSelfLeftTarget(): void {
        if (this.selfReachedTarget && !this.isPlayerAtTarget(this.self)) {
            this.selfReachedTarget = false
            this.gameEvtHandler(Events.SELF_LEFT_TARGET, new Evt_SelfLeftTarget(this.self))
        }
    }

    beforeExit(): void {
        if (this.timerId) clearInterval(this.timerId)
        if (this.botTimerIds) {
            this.botTimerIds.forEach(botTimerId => {
                clearInterval(botTimerId)
            })
        }
    }

    on_round_end(): Transition {
        return new RoundEnded(
            this.gameEvtHandler,
            this.players,
            this.activePlayers,
            this.self,
            this.eliminatedPlayers,
            this.targetGenerator,
            this.roundLength,
            this.selfFsm,
            this.roundNo,
            this.target,
            this.moveDelay,
            this.logger
        )
    }

    private isPlayerAtTarget(player: Player): boolean {
        const dx = player.position.x - this.target.x
        const dy = player.position.y - this.target.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        return distance <= 1
    }

    private moveBot(botPlayer: Player, target: Position): void {
        if (Date.now() - this.lastMoveTimes[botPlayer.id] < this.moveDelay) {
            return
        }

        if (Math.random() < 0.1) {
            const directions = [
                { x: 0, y: -1 },
                { x: 0, y: 1 },
                { x: -1, y: 0 },
                { x: 1, y: 0 }
            ]
            const randomDir = directions[Math.floor(Math.random() * directions.length)]
            botPlayer.position.x += randomDir.x
            botPlayer.position.y += randomDir.y
        } else if (!this.isPlayerAtTarget(botPlayer)) {
            const dx = target.x - botPlayer.position.x
            const dy = target.y - botPlayer.position.y

            if (Math.abs(dx) > Math.abs(dy)) {
                botPlayer.position.x += dx > 0 ? 1 : -1
            } else {
                botPlayer.position.y += dy > 0 ? 1 : -1
            }
        }

        this.lastMoveTimes[botPlayer.id] = Date.now()
        this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))
    }
}

// ============================================================================
// TeleportingSubState
// ============================================================================

class TeleportingSubState extends SubState {
    private readonly fsm: GameEngineFSM
    private readonly player: Player
    private readonly wormhole: Wormhole
    private readonly gameEvtHandler: GameEvtHandler
    private timerId: ReturnType<typeof setTimeout> | null

    constructor(
        parent: State,
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
        this.gameEvtHandler(Events.PLAYER_TELEPORTED, new Evt_PlayerTeleported(this.player, this.wormhole))

        // Start animation timer
        const TELEPORT_ANIMATION_DURATION = 600
        this.timerId = setTimeout(() => {
            this.fsm.handleEvent("teleport_complete")
        }, TELEPORT_ANIMATION_DURATION)
    }

    beforeExit(): void {
        if (this.timerId) clearTimeout(this.timerId)
    }

    on_key_press(key: KeyboardKey): Transition {
        return SpecialTransition.deferralTransition
    }

    on_teleport_complete(): Transition {
        return SpecialTransition.ReturnToParent
    }

    // on_round_end bubbles to parent via SubState.react()
}

// ============================================================================
// RoundEnded State
// ============================================================================

class RoundEnded extends State {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly players: Player[]
    private readonly activePlayers: Player[]
    private readonly self: Player
    private readonly eliminatedPlayers: Player[]
    private readonly targetGenerator: TargetGenerator
    private readonly roundLength: number
    private readonly selfFsm: GameEngineFSM
    private readonly roundNo: number
    private readonly target: Position
    private readonly moveDelay: number
    private readonly logger: Logger
    private loserPosition: Position | null

    constructor(
        gameEvtHandler: GameEvtHandler,
        players: Player[],
        activePlayers: Player[],
        self: Player,
        eliminatedPlayers: Player[],
        targetGenerator: TargetGenerator,
        roundLength: number,
        selfFsm: GameEngineFSM,
        roundNo: number,
        target: Position,
        moveDelay: number,
        logger: Logger
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.players = players
        this.activePlayers = activePlayers
        this.self = self
        this.eliminatedPlayers = eliminatedPlayers
        this.targetGenerator = targetGenerator
        this.roundLength = roundLength
        this.selfFsm = selfFsm
        this.roundNo = roundNo
        this.target = target
        this.moveDelay = moveDelay
        this.logger = logger
        this.loserPosition = null
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

    on_launch(): Transition {
        const eliminatedPlayer = this.eliminateLoser()

        if (this.activePlayers.length === 1) {
            const winner_player = this.activePlayers[0]
            return new GameOver(this.gameEvtHandler, this.roundNo, this.players, winner_player)
        } else if (eliminatedPlayer !== null) {
            this.loserPosition = eliminatedPlayer.position
        }

        const roundSummary = new RoundSummary(this.roundNo, eliminatedPlayer)
        this.gameEvtHandler(Events.ROUND_END, new Evt_RoundEnd(roundSummary))
    }

    on_ready_to_host(): Transition {
        const newTarget = this.loserPosition !== null ? this.loserPosition : this.targetGenerator()
        return new PlayingRound(
            this.gameEvtHandler,
            this.players,
            this.activePlayers,
            this.eliminatedPlayers,
            this.self,
            this.targetGenerator,
            this.roundLength,
            this.selfFsm,
            this.roundNo + 1,
            this.moveDelay,
            newTarget,
            this.logger
        )
    }
}

// ============================================================================
// GameOver State
// ============================================================================

class GameOver extends State {
    private readonly gameEvtHandler: GameEvtHandler
    private readonly roundNo: number
    private readonly players: Player[]
    private readonly winner_player: Player

    constructor(
        gameEvtHandler: GameEvtHandler,
        roundNo: number,
        players: Player[],
        winner_player: Player
    ) {
        super()
        this.gameEvtHandler = gameEvtHandler
        this.roundNo = roundNo
        this.players = players
        this.winner_player = winner_player
    }

    onEntry(): void {
        const game_summary = new GameSummary(this.roundNo, this.players, this.winner_player)
        this.gameEvtHandler(Events.GAME_OVER, new Evt_GameOver(game_summary))
    }
}
