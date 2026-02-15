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
    GameConfig,
    KeyPressEvent
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

// Bot colors for visual distinction
const BOT_COLORS = [0x00ff00, 0x00aaff, 0xffaa00, 0xff00ff, 0xffff00, 0x00ffff]

// Human player ID - matches the ID assigned in GameEngineFSM
const SELF_PLAYER_ID = "self_id"

export class GameRenderer extends Phaser.Scene {
    private engine: GameEngineFSM | null
    private playersRects: Record<string, Phaser.GameObjects.Rectangle> | null
    private countdown: Phaser.GameObjects.Text | null
    private targetGraphics: Phaser.GameObjects.Graphics | null
    private targetGlow: Phaser.GameObjects.Graphics | null
    private targetPulseTween: Phaser.Tweens.Tween | null
    private targetPosition: Position | null
    private wormholeGraphics: Phaser.GameObjects.Graphics[]
    private wormholeEntranceTweens: Phaser.Tweens.Tween[]
    private pendingEvents: PendingEvent[]
    guiEvtListener : FGuiEventListener | null
    botClientFactory: ((botPlayers: BotPlayer[], guiEvtSender: FGuiEventListener) => void) | null

    // Config UI state
    private configUI: Phaser.GameObjects.GameObject[] | null
    private configValues: {
        numBots: number
        botExpertise: number
        playerSpeed: number
        roundDuration: number
    }

    constructor() {
        super("game")
        this.engine = null
        this.playersRects = null
        this.countdown = null
        this.targetGraphics = null
        this.targetGlow = null
        this.targetPulseTween = null
        this.targetPosition = null
        this.wormholeGraphics = []
        this.wormholeEntranceTweens = []
        this.pendingEvents = []
        this.guiEvtListener = null
        this.botClientFactory = null
        this.configUI = null
        this.configValues = {
            numBots: 3,
            botExpertise: 2,
            playerSpeed: 100,
            roundDuration: 10
        }

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
        this.drawGrid()

        this.input.keyboard!.on("keydown-LEFT", () => {
            this.propagateGuiEvt(GuiEventType.key_press, new KeyPressEvent(SELF_PLAYER_ID, keyboardKeys.LEFT, Date.now()))
        })

        this.input.keyboard!.on("keydown-RIGHT", () => {
          this.propagateGuiEvt(GuiEventType.key_press, new KeyPressEvent(SELF_PLAYER_ID, keyboardKeys.RIGHT, Date.now()))
        })

        this.input.keyboard!.on("keydown-UP", () => {
            this.propagateGuiEvt(GuiEventType.key_press, new KeyPressEvent(SELF_PLAYER_ID, keyboardKeys.UP, Date.now()))
        })

        this.input.keyboard!.on("keydown-DOWN", () => {
            this.propagateGuiEvt(GuiEventType.key_press, new KeyPressEvent(SELF_PLAYER_ID, keyboardKeys.DOWN, Date.now()))
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
        if (this.targetGraphics) {
            this.targetGraphics.destroy()
        }
        if (this.targetGlow) {
            this.targetGlow.destroy()
        }
        if (this.targetPulseTween) {
            this.targetPulseTween.stop()
            this.targetPulseTween = null
        }
        this.playersRects = null
        this.countdown = null
        this.targetGraphics = null
        this.targetGlow = null
        this.targetPosition = null
        if (this.wormholeEntranceTweens) {
            this.wormholeEntranceTweens.forEach(t => t.stop())
            this.wormholeEntranceTweens = []
        }
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

        // Draw target as a star with glow
        this.targetPosition = evt_round_start.target
        this.drawTarget(evt_round_start.target, 0xffdd00) // Golden yellow
        this.startTargetPulse()

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
        console.log("Game started - showing config UI")
        this.showConfigUI()
    }

    private showConfigUI(): void {
        this.configUI = []
        const centerX = GRID_W * CELL / 2
        const startY = 100
        const lineHeight = 50

        // Title
        const title = this.add.text(centerX, startY, "Game Configuration", {
            fontSize: "32px",
            color: "#ffffff",
            fontFamily: "monospace"
        }).setOrigin(0.5)
        this.configUI.push(title)

        // Number of Bots (1-6)
        this.createConfigRow(centerX, startY + lineHeight * 2, "Number of Bots", 
            () => this.configValues.numBots.toString(),
            () => { if (this.configValues.numBots > 1) this.configValues.numBots--; this.refreshConfigUI() },
            () => { if (this.configValues.numBots < 6) this.configValues.numBots++; this.refreshConfigUI() }
        )

        // Bot Expertise (1-5)
        this.createConfigRow(centerX, startY + lineHeight * 3, "Bot Expertise", 
            () => this.configValues.botExpertise.toString(),
            () => { if (this.configValues.botExpertise > 1) this.configValues.botExpertise--; this.refreshConfigUI() },
            () => { if (this.configValues.botExpertise < 5) this.configValues.botExpertise++; this.refreshConfigUI() }
        )

        // Player Speed (50-500ms, step 25)
        this.createConfigRow(centerX, startY + lineHeight * 4, "Move Delay (ms)", 
            () => this.configValues.playerSpeed.toString(),
            () => { if (this.configValues.playerSpeed > 50) this.configValues.playerSpeed -= 25; this.refreshConfigUI() },
            () => { if (this.configValues.playerSpeed < 500) this.configValues.playerSpeed += 25; this.refreshConfigUI() }
        )

        // Round Duration (5-60 seconds, step 5)
        this.createConfigRow(centerX, startY + lineHeight * 5, "Round Duration (s)", 
            () => this.configValues.roundDuration.toString(),
            () => { if (this.configValues.roundDuration > 5) this.configValues.roundDuration -= 5; this.refreshConfigUI() },
            () => { if (this.configValues.roundDuration < 60) this.configValues.roundDuration += 5; this.refreshConfigUI() }
        )

        // Start Game Button
        const startButton = this.add.text(centerX, startY + lineHeight * 7, "[ START GAME ]", {
            fontSize: "28px",
            color: "#00ff00",
            fontFamily: "monospace",
            backgroundColor: "#004400",
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })

        startButton.on("pointerover", () => startButton.setColor("#88ff88"))
        startButton.on("pointerout", () => startButton.setColor("#00ff00"))
        startButton.on("pointerdown", () => this.startGameWithConfig())
        this.configUI.push(startButton)

        // Instructions
        const instructions = this.add.text(centerX, startY + lineHeight * 9, 
            "Click arrows to adjust values, then click START GAME", {
            fontSize: "14px",
            color: "#888888",
            fontFamily: "monospace"
        }).setOrigin(0.5)
        this.configUI.push(instructions)
    }

    private createConfigRow(
        centerX: number, 
        y: number, 
        label: string, 
        getValue: () => string,
        onDecrease: () => void,
        onIncrease: () => void
    ): void {
        const labelText = this.add.text(centerX - 200, y, label + ":", {
            fontSize: "20px",
            color: "#ffffff",
            fontFamily: "monospace"
        }).setOrigin(0, 0.5)
        this.configUI!.push(labelText)

        // Decrease button
        const decreaseBtn = this.add.text(centerX + 50, y, "◀", {
            fontSize: "24px",
            color: "#ffaa00",
            fontFamily: "monospace"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        decreaseBtn.on("pointerover", () => decreaseBtn.setColor("#ffff00"))
        decreaseBtn.on("pointerout", () => decreaseBtn.setColor("#ffaa00"))
        decreaseBtn.on("pointerdown", onDecrease)
        this.configUI!.push(decreaseBtn)

        // Value display
        const valueText = this.add.text(centerX + 100, y, getValue(), {
            fontSize: "24px",
            color: "#00ffff",
            fontFamily: "monospace"
        }).setOrigin(0.5)
        valueText.setData("getValue", getValue)
        this.configUI!.push(valueText)

        // Increase button
        const increaseBtn = this.add.text(centerX + 150, y, "▶", {
            fontSize: "24px",
            color: "#ffaa00",
            fontFamily: "monospace"
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        increaseBtn.on("pointerover", () => increaseBtn.setColor("#ffff00"))
        increaseBtn.on("pointerout", () => increaseBtn.setColor("#ffaa00"))
        increaseBtn.on("pointerdown", onIncrease)
        this.configUI!.push(increaseBtn)
    }

    private refreshConfigUI(): void {
        if (!this.configUI) return
        // Update all value displays
        this.configUI.forEach(obj => {
            if (obj instanceof Phaser.GameObjects.Text) {
                const getValue = obj.getData("getValue") as (() => string) | undefined
                if (getValue) {
                    obj.setText(getValue())
                }
            }
        })
    }

    private destroyConfigUI(): void {
        if (this.configUI) {
            this.configUI.forEach(obj => obj.destroy())
            this.configUI = null
        }
    }

    private startGameWithConfig(): void {
        console.log("Starting game with config:", this.configValues)
        this.destroyConfigUI()

        // Create bot players based on configuration
        const botPlayers: BotPlayer[] = []
        for (let i = 0; i < this.configValues.numBots; i++) {
            const botId = `bot${i + 1}`
            const botName = `Bot ${i + 1}`
            const botColor = BOT_COLORS[i % BOT_COLORS.length]
            botPlayers.push(new BotPlayer(botId, botName, new Position(0, 0), botColor, this.configValues.botExpertise))
        }

        const gameConfig: GameConfig = new GameConfig(
            botPlayers,
            this.configValues.roundDuration * 1000, // convert to ms
            this.configValues.playerSpeed
        )

        // Create BotClients for each bot player
        if (this.botClientFactory && this.guiEvtListener) {
            this.botClientFactory(botPlayers, this.guiEvtListener)
        }

        this.propagateGuiEvt(GuiEventType.game_configured, gameConfig)
    }

    private handlePlayerPositionsUpdate(evt_player_positions_update: Evt_PlayerPositionsUpdate): void {
        //console.log(`handlePlayerPositionsUpdate`)
        this.renderPlayers(evt_player_positions_update.players)
    }

    private handleSelfReachedTarget(evt_self_reached_target: Evt_SelfReachedTarget): void {
        console.log(`Self player reached target!`)
        const player = evt_self_reached_target.player
        
        // Redraw target with player's color
        if (this.targetPosition) {
            if (this.targetPulseTween) {
                this.targetPulseTween.stop()
            }
            if (this.targetGraphics) this.targetGraphics.destroy()
            if (this.targetGlow) this.targetGlow.destroy()
            
            this.drawTarget(this.targetPosition, player.color)
            
            // Fast blink animation when reached
            this.targetPulseTween = this.tweens.add({
                targets: [this.targetGraphics, this.targetGlow],
                alpha: { from: 1.0, to: 0.2 },
                duration: 200,
                loop: -1,
                yoyo: true
            })
        }
    }

    private handleSelfLeftTarget(evt_self_left_target: Evt_SelfLeftTarget): void {
        console.log(`Self player left target!`)
        if (this.targetPulseTween) {
            this.targetPulseTween.stop()
            this.targetPulseTween = null
        }

        // Restore golden target
        if (this.targetPosition) {
            if (this.targetGraphics) this.targetGraphics.destroy()
            if (this.targetGlow) this.targetGlow.destroy()
            this.drawTarget(this.targetPosition, 0xffdd00)
            this.startTargetPulse()
        }
    }

    private processGameEvt(evt: EventType, evtData?: GameEventPayload): void {
        //console.log(`Processing game event: ${evt}, data: ${JSON.stringify(evtData)}`)
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
        this.wormholeEntranceTweens = []
        
        wormholes.forEach(w => {
            const entranceX = w.entrance.x * CELL + CELL / 2
            const entranceY = w.entrance.y * CELL + CELL / 2
            const exitX = w.exit.x * CELL + CELL / 2
            const exitY = w.exit.y * CELL + CELL / 2
            
            // Draw entrance as hollow ring with spiral (draw at origin, position with setPosition)
            const entranceGraphics = this.add.graphics({ x: entranceX, y: entranceY })
            this.drawWormholeEntrance(entranceGraphics, 0, 0, w.color)
            this.wormholeGraphics.push(entranceGraphics)
            
            // Rotate entrance spiral around its center
            const entranceTween = this.tweens.add({
                targets: entranceGraphics,
                angle: 360,
                duration: 3000,
                loop: -1,
                ease: 'Linear'
            })
            this.wormholeEntranceTweens.push(entranceTween)
            
            // Draw exit as filled circle with outward arrow
            const exitGraphics = this.add.graphics()
            this.drawWormholeExit(exitGraphics, exitX, exitY, w.color)
            this.wormholeGraphics.push(exitGraphics)
            
            // Connection line from entrance to exit (dashed effect)
            const line = this.add.graphics()
            this.drawDashedLine(line, entranceX, entranceY, exitX, exitY, w.color)
            this.wormholeGraphics.push(line)
        })
    }
    
    private drawWormholeEntrance(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
        const radius = CELL / 2 - 4
        const innerRadius = radius - 4
        
        // Outer ring
        g.lineStyle(3, color, 0.9)
        g.strokeCircle(x, y, radius)
        
        // Inner ring
        g.lineStyle(2, color, 0.5)
        g.strokeCircle(x, y, innerRadius)
        
        // Spiral arms (suggest "sucking in")
        g.lineStyle(2, color, 0.7)
        for (let i = 0; i < 3; i++) {
            const angle = (i * Math.PI * 2) / 3
            const startX = x + Math.cos(angle) * innerRadius * 0.3
            const startY = y + Math.sin(angle) * innerRadius * 0.3
            const endX = x + Math.cos(angle + 0.5) * radius * 0.8
            const endY = y + Math.sin(angle + 0.5) * radius * 0.8
            g.lineBetween(startX, startY, endX, endY)
        }
    }
    
    private drawWormholeExit(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
        const radius = CELL / 2 - 4
        
        // Filled circle with lighter color
        const lighterColor = this.lightenColor(color, 0.3)
        g.fillStyle(lighterColor, 0.6)
        g.fillCircle(x, y, radius)
        
        // Border
        g.lineStyle(2, color, 0.9)
        g.strokeCircle(x, y, radius)
        
        // Outward arrows (4 directions)
        g.lineStyle(2, color, 0.8)
        const arrowSize = 6
        const arrowDist = radius * 0.5
        
        // Draw 4 outward chevrons
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2
            const tipX = x + Math.cos(angle) * arrowDist
            const tipY = y + Math.sin(angle) * arrowDist
            
            // Chevron pointing outward
            const leftX = tipX - Math.cos(angle) * arrowSize + Math.cos(angle + Math.PI/2) * arrowSize * 0.5
            const leftY = tipY - Math.sin(angle) * arrowSize + Math.sin(angle + Math.PI/2) * arrowSize * 0.5
            const rightX = tipX - Math.cos(angle) * arrowSize - Math.cos(angle + Math.PI/2) * arrowSize * 0.5
            const rightY = tipY - Math.sin(angle) * arrowSize - Math.sin(angle + Math.PI/2) * arrowSize * 0.5
            
            g.lineBetween(leftX, leftY, tipX, tipY)
            g.lineBetween(rightX, rightY, tipX, tipY)
        }
    }
    
    private drawDashedLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number): void {
        const dashLength = 8
        const gapLength = 6
        
        const dx = x2 - x1
        const dy = y2 - y1
        const distance = Math.sqrt(dx * dx + dy * dy)
        const dashCount = Math.floor(distance / (dashLength + gapLength))
        
        const unitX = dx / distance
        const unitY = dy / distance
        
        g.lineStyle(2, color, 0.3)
        
        for (let i = 0; i < dashCount; i++) {
            const startDist = i * (dashLength + gapLength)
            const endDist = startDist + dashLength
            
            g.lineBetween(
                x1 + unitX * startDist,
                y1 + unitY * startDist,
                x1 + unitX * endDist,
                y1 + unitY * endDist
            )
        }
    }
    
    private drawTarget(pos: Position, color: number): void {
        const x = pos.x * CELL + CELL / 2
        const y = pos.y * CELL + CELL / 2
        const outerRadius = CELL / 2 - 2
        const innerRadius = outerRadius * 0.5
        
        // Draw glow behind
        this.targetGlow = this.add.graphics()
        this.targetGlow.fillStyle(color, 0.3)
        this.targetGlow.fillCircle(x, y, outerRadius + 4)
        
        // Draw star
        this.targetGraphics = this.add.graphics()
        this.targetGraphics.fillStyle(color, 1.0)
        
        // 5-pointed star
        const points: number[] = []
        for (let i = 0; i < 10; i++) {
            const angle = (i * Math.PI) / 5 - Math.PI / 2 // Start from top
            const radius = i % 2 === 0 ? outerRadius : innerRadius
            points.push(x + Math.cos(angle) * radius)
            points.push(y + Math.sin(angle) * radius)
        }
        
        this.targetGraphics.fillPoints(points, true)
        
        // Add border
        this.targetGraphics.lineStyle(2, 0xffffff, 0.8)
        this.targetGraphics.strokePoints(points, true)
    }
    
    private startTargetPulse(): void {
        if (this.targetGlow) {
            this.targetPulseTween = this.tweens.add({
                targets: this.targetGlow,
                alpha: { from: 0.3, to: 0.8 },
                duration: 800,
                loop: -1,
                yoyo: true,
                ease: 'Sine.easeInOut'
            })
        }
    }
    
    private lightenColor(color: number, amount: number): number {
        const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount)
        const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount)
        const b = Math.min(255, (color & 0xff) + 255 * amount)
        return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b)
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
