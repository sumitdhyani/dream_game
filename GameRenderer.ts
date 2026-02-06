import { 
    CELL, 
    GRID_W,
    GRID_H,
    GUIEventPayload,
    Events,
    keyboardKeys,
    Evt_RoundEnd,
    Evt_RoundStart,
    Evt_PlayerPositionsUpdate,
    Evt_SelfReachedTarget,
    Evt_SelfLeftTarget,
    Evt_GameOver,
    Evt_TimerTick,
    Evt_PlayerTeleported,
    Player,
    BotPlayer,
    Position,
    Wormhole,
    EventType,
    GameEventPayload,
    GuiEventType,
    GameConfig
} from './GlobalGameReference.js'
import { GameEngineFSM } from './GameEngineFSM.js'
import { setupBridge } from './ComponentIntegration.js'
import { FGuiEventListener } from './NetworkInterface.js'

// Phaser is loaded globally via script tag in index.html
declare const Phaser: typeof import('phaser')

interface PendingEvent {
    evt: EventType
    evtData: GameEventPayload | undefined
}

export class GameRenderer extends Phaser.Scene {
    private engine: GameEngineFSM | null
    private playersRects: Record<string, Phaser.GameObjects.Rectangle> | null
    private countdown: Phaser.GameObjects.Text | null
    private targetRect: Phaser.GameObjects.Rectangle | null
    private targetPulseTween: Phaser.Tweens.Tween | null
    private wormholeGraphics: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics)[]
    private pendingEvents: PendingEvent[]
    guiEvtListener : ((evtType: string, evtData?: GUIEventPayload) => void) | null

    constructor() {
        super("game")
        this.engine = null
        this.playersRects = null
        this.countdown = null
        this.targetRect = null
        this.targetPulseTween = null
        this.wormholeGraphics = []
        this.pendingEvents = []
        this.guiEvtListener = null

        setupBridge(this)
    }

    propagateGuiEvt(evt: string, evtData?: GUIEventPayload): void {
      if (!this.guiEvtListener) {
        console.warn("No GUI event listener registered in GameRenderer to receive GUI events")
        return
      }

      this.guiEvtListener(evt, evtData)
    }

    create(): void {
        this.pendingEvents = []
        this.drawGrid()

        this.input.keyboard!.on("keydown-LEFT", () => {
            this.propagateGuiEvt(GuiEventType.key_press, keyboardKeys.LEFT)
        })

        this.input.keyboard!.on("keydown-RIGHT", () => {
          this.propagateGuiEvt(GuiEventType.key_press, keyboardKeys.RIGHT)
        })

        this.input.keyboard!.on("keydown-UP", () => {
            this.propagateGuiEvt(GuiEventType.key_press, keyboardKeys.UP)
        })

        this.input.keyboard!.on("keydown-DOWN", () => {
            this.propagateGuiEvt(GuiEventType.key_press, keyboardKeys.DOWN)
        })

        this.events.once("shutdown", () => {
            this.input.keyboard!.removeAllListeners()
        })
    }

    private destroyPreviousRound(): void {
        if (this.playersRects) {
            Object.values(this.playersRects).forEach(r => r.destroy())
        }
        if (this.countdown) {
            this.countdown.destroy()
        }
        if (this.targetRect) {
            this.targetRect.destroy()
        }
        this.playersRects = null
        this.countdown = null
        this.targetRect = null
        if (this.wormholeGraphics) {
            this.wormholeGraphics.forEach(g => g.destroy())
            this.wormholeGraphics = []
        }
    }

    private handleGameOver(evt_game_over: Evt_GameOver): void {
        this.destroyPreviousRound()
        const gameSummary = evt_game_over.game_summary
        const winnerName = gameSummary.winner.name
        const gameSummaryText = `Game Over! , participants:\n ${gameSummary.players.map(p => p.name).toString()}\n Winner: ${winnerName}`
        console.log(`Game over! Winner: ${winnerName}`)
        this.add.text(
            0,
            0,
            gameSummaryText,
            {
                fontSize: "24px",
                color: "#ffffff",
                fontFamily: "monospace",
                align: "center"
            }
        )
    }

    private handleRoundEnd(evt_round_end: Evt_RoundEnd): void {
        const roundSummary = evt_round_end.roundSummary
        const roundSummaryText = `${roundSummary.eliminated_player !== null ? roundSummary.eliminated_player.name : "None"} eliminated in Round ${roundSummary.round_number}`
        console.log(`Round ended, summary: ${roundSummaryText}`)
        this.destroyPreviousRound()
        const roundSummaryTextElement = this.add.text(
            GRID_W * CELL / 2,
            GRID_H * CELL / 2,
            roundSummaryText,
            {
                fontSize: "20px",
                color: "#ffffff",
                fontFamily: "monospace"
            }
        )

        setTimeout(() => {
            roundSummaryTextElement.destroy()
            this.propagateGuiEvt(GuiEventType.ready_to_host)
        }, 2000)
    }

    private handleRoundStart(evt_round_start: Evt_RoundStart): void {
        console.log(`Round started, number: ${evt_round_start.round}, duration: ${evt_round_start.duration}, players: ${evt_round_start.players.reduce((acc, p) => acc + p.name + ", ", "")}`)

        this.playersRects = {}
        evt_round_start.players.forEach(p => {
            this.playersRects![p.id] = this.add.rectangle(
                p.position.x * CELL + CELL / 2,
                p.position.y * CELL + CELL / 2,
                CELL - 6, CELL - 6, p.color
            )
        })

        this.countdown = this.add.text(
            GRID_W * CELL - 10,
            10,
            Math.round(evt_round_start.duration / 1000).toString(),
            {
                fontSize: "20px",
                color: "#ffffff",
                fontFamily: "monospace"
            }
        )

        this.targetRect = this.add.rectangle(
            evt_round_start.target.x * CELL + CELL / 2,
            evt_round_start.target.y * CELL + CELL / 2,
            CELL - 4, CELL - 4, 0xff3333
        )

        this.countdown.setOrigin(1, 0)
        this.renderPlayers(evt_round_start.players)
        if (evt_round_start.wormholes) {
            this.renderWormholes(evt_round_start.wormholes)
        }
    }

    private handleRoundTick(evt_round_tick: Evt_TimerTick): void {
        const time_left_sec = Math.floor(evt_round_tick.time_left / 1000)
        if (this.countdown) {
            this.countdown.setText(time_left_sec.toString())
        }
    }

    private handleGameStart(): void {
        console.log("Game started")
        this.propagateGuiEvt(GuiEventType.ready_to_host)
    }

    private handlePlayerPositionsUpdate(evt_player_positions_update: Evt_PlayerPositionsUpdate): void {
        console.log(`handlePlayerPositionsUpdate`)
        this.renderPlayers(evt_player_positions_update.players)
    }

    private handleSelfReachedTarget(evt_self_reached_target: Evt_SelfReachedTarget): void {
        console.log(`Self player reached target!`)
        const player = evt_self_reached_target.player
        if (this.targetRect) {
            this.targetRect.setFillStyle(player.color)
            this.targetRect.setAlpha(1.0)
        }

        if (this.targetPulseTween) {
            this.targetPulseTween.stop()
        }

        this.targetPulseTween = this.tweens.add({
            targets: this.targetRect,
            alpha: [1.0, 0.0],
            duration: 400,
            loop: -1,
            yoyo: true
        })
    }

    private handleSelfLeftTarget(evt_self_left_target: Evt_SelfLeftTarget): void {
        console.log(`Self player left target!`)
        if (this.targetPulseTween) {
            this.targetPulseTween.stop()
            this.targetPulseTween = null
        }

        if (this.targetRect) {
            this.targetRect.setFillStyle(0xff3333)
            this.targetRect.setAlpha(1.0)
        }
    }

    private processGameEvt(evt: EventType, evtData?: GameEventPayload): void {
        switch (evt) {
            case Events.GAME_START:
                this.handleGameStart()
                break
            case Events.ROUND_START:
                this.handleRoundStart(evtData as Evt_RoundStart)
                break
            case Events.ROUND_END:
                this.handleRoundEnd(evtData as Evt_RoundEnd)
                break
            case Events.PLAYER_POSITIONS_UPDATE:
                this.handlePlayerPositionsUpdate(evtData as Evt_PlayerPositionsUpdate)
                break
            case Events.SELF_REACHED_TARGET:
                this.handleSelfReachedTarget(evtData as Evt_SelfReachedTarget)
                break
            case Events.SELF_LEFT_TARGET:
                this.handleSelfLeftTarget(evtData as Evt_SelfLeftTarget)
                break
            case Events.TIMER_TICK:
                this.handleRoundTick(evtData as Evt_TimerTick)
                break
            case Events.GAME_OVER:
                this.handleGameOver(evtData as Evt_GameOver)
                break
            case Events.PLAYER_TELEPORTED:
                this.handlePlayerTeleported(evtData as Evt_PlayerTeleported)
                break
        }
    }

    private renderWormholes(wormholes: Wormhole[]): void {
        this.wormholeGraphics = []
        wormholes.forEach(w => {
            // Exit only (entrance is invisible)
            const exitRect = this.add.rectangle(
                w.exit.x * CELL + CELL / 2,
                w.exit.y * CELL + CELL / 2,
                CELL - 8, CELL - 8, w.color, 0.6
            )
            this.wormholeGraphics.push(exitRect)

            // Connection line from entrance to exit
            const line = this.add.graphics()
            line.lineStyle(2, w.color, 0.3)
            line.lineBetween(
                w.entrance.x * CELL + CELL / 2,
                w.entrance.y * CELL + CELL / 2,
                w.exit.x * CELL + CELL / 2,
                w.exit.y * CELL + CELL / 2
            )
            this.wormholeGraphics.push(line)
        })
    }

    private handlePlayerTeleported(evt_player_teleported: Evt_PlayerTeleported): void {
        const player = evt_player_teleported.player
        const wormhole = evt_player_teleported.wormhole
        if (!this.playersRects) return
        
        const r = this.playersRects[player.id]
        this.tweens.add({
            targets: r,
            alpha: 0,
            duration: 200,
            onComplete: () => {
                r.x = wormhole.exit.x * CELL + CELL / 2
                r.y = wormhole.exit.y * CELL + CELL / 2
                this.tweens.add({
                    targets: r,
                    alpha: 1,
                    duration: 200
                })
            }
        })
    }

    onGameEvt(evt: EventType, evtData?: GameEventPayload): void {
        this.pendingEvents.push({ evt, evtData })
    }

    private drawGrid(): void {
        const g = this.add.graphics()
        g.lineStyle(1, 0x333333, 1)

        for (let x = 0; x <= GRID_W; x++) {
            g.lineBetween(x * CELL, 0, x * CELL, GRID_H * CELL)
        }

        for (let y = 0; y <= GRID_H; y++) {
            g.lineBetween(0, y * CELL, GRID_W * CELL, y * CELL)
        }
    }

    private processPendingEvents(): void {
        while (this.pendingEvents.length > 0) {
            const { evt, evtData } = this.pendingEvents[0]
            this.processGameEvt(evt, evtData)
            this.pendingEvents.splice(0, 1)
        }
    }

    update(time: number, delta: number): void {
        this.processPendingEvents()
    }

    private renderPlayers(players: Player[]): void {
        if (!this.playersRects) return
        
        players.forEach(p => {
            p.position.x = Phaser.Math.Clamp(p.position.x, 0, GRID_W - 1)
            p.position.y = Phaser.Math.Clamp(p.position.y, 0, GRID_H - 1)
            const r = this.playersRects![p.id]
            r.visible = p.alive
            if (!p.alive) {
                console.log(`Player ${p.id} is eliminated, hiding rectangle`)
            }
            r.x = p.position.x * CELL + CELL / 2
            r.y = p.position.y * CELL + CELL / 2
        })
    }
}
