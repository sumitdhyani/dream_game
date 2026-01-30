import { CELL, GRID_W, GRID_H } from './GlobalGameReference.js'
import { Events, keyboardKeys,  Evt_RoundEnd, Evt_RoundStart, Evt_PlayerPositionsUpdate } from './GlobalGameReference.js'
import { Player, Position} from './GlobalGameReference.js'
import { GameEngine } from './GameEngine.js'
import { GameeEngineFSM } from './GameEngineFSM.js'
export class GameRenderer extends Phaser.Scene {
  constructor() { super("game") 
    this.engine = null
    this.playersRects = null
    this.countdown = null
    this.targetRect = null
  }

  create() {
    const engine = new GameEngine(this.onGameEvt.bind(this))
    const players = [
      new Player(1, "p1", new Position(1, 1), 0x00ff00),
      new Player(2, "p2", new Position(18, 2), 0x00aaff),
      new Player(3, "p3", new Position(5, 17), 0xffaa00)
    ]

    this.GameEngineFSM = new GameeEngineFSM(engine,
                                            players,
                                            players[0],
                                            new Position(Math.floor(Math.random() * GRID_W),
                                                         Math.floor(Math.random() * GRID_H)),
                                            {info: (str) => console.log(str),
                                             warn:  (str) => console.log(str),
                                             error: (str) => console.log(str),
                                             debug:  (str) => console.log(str)})

    this.GameEngineFSM.start()
    // this.engine.startGame(players, 
    //                       players[0],
    //                       new Position(Math.floor(Math.random() * GRID_W),
    //                                    Math.floor(Math.random() * GRID_H)))

    console.log("Game started!")

    this.pendingEvents = []// List of {evt, evtData}

    this.drawGrid()

    this.input.keyboard.on("keydown-LEFT", () => {
      this.GameEngineFSM.handleEvent("key_press", keyboardKeys.LEFT)
    })

    this.input.keyboard.on("keydown-RIGHT", () => {
      this.GameEngineFSM.handleEvent("key_press", keyboardKeys.RIGHT)
    })

    this.input.keyboard.on("keydown-UP", () => {
      this.GameEngineFSM.handleEvent("key_press", keyboardKeys.UP)
    })

    this.input.keyboard.on("keydown-DOWN", () => {
      this.GameEngineFSM.handleEvent("key_press", keyboardKeys.DOWN)
    })

    this.events.once("shutdown", () => {
      this.input.keyboard.removeAllListeners()
    })

  }

  destroyPreviousRound() {
    this.playersRects.forEach(r => r.destroy())
    this.countdown.destroy()
    this.targetRect.destroy()
    this.playersRects = null
    this.countdown = null
    this.targetRect = null
  }

  handleGameOver(evt_game_over) {
    this.GameEngineFSM.handleEvent("game_over")
    this.destroyPreviousRound()
    // Logic to handle game over
    const gameSummary = evt_game_over.game_summary
    const winnerName = gameSummary.winner.name
    const gameSummaryText = `Game Over! , participants:\n ${gameSummary.players.map(p => p.name).toString()}\n Winner: ${winnerName}`
    console.log(`Game over! Winner: ${winnerName}`)
    const gameOverTextElement = this.add.text(
      0,   // x
      0,   // y  
      gameSummaryText,
      {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "monospace",
        align: "center"
      }
    )
  }

  handleRoundEnd(evt_round_end) {
    this.GameEngineFSM.handleEvent("round_end")
    this.pendingEvents = []
    // Logic to handle end of round
    const roundSummary = evt_round_end.roundSummary
    const roundSummaryText = `${roundSummary.eliminated_player.name} eliminated in Round ${roundSummary.round_number}`
    console.log(`Round ended, summary: ${roundSummaryText}`)
    this.destroyPreviousRound()
    const roundSummaryTextElement = this.add.text(
      GRID_W * CELL / 2,   // x
      GRID_H * CELL / 2,   // y
      roundSummaryText,
      {
        fontSize: "20px",
        color: "#ffffff",
        fontFamily: "monospace"
      }
    )

    setTimeout(() => {
      roundSummaryTextElement.destroy()
      this.GameEngineFSM.handleEvent("ready_to_host")
    }, 2000)
  }

  handleRoundStart(evt_round_start) {
    console.log(`Round started, number: ${evt_round_start.round}, duration: ${evt_round_start.duration}, players: ${evt_round_start.players.reduce((acc, p) => acc + p.name + ", ", ""  )} `)

    this.playersRects = []
    evt_round_start.players.forEach(p => {
      console.log(`Wink! Rendering player ${p.id} at (${p.position.x}, ${p.position.y})`)
      this.playersRects[p.id] = this.add.rectangle(
        p.position.x * CELL + CELL / 2,
        p.position.y * CELL + CELL / 2,
        CELL - 6, CELL - 6, p.color
      )
    })

    this.countdown = this.add.text(
      GRID_W * CELL - 10,   // x
      10,                  // y
      Math.round(evt_round_start.duration/1000).toString(),                // initial text
      {
        fontSize: "20px",
        color: "#ffffff",
        fontFamily: "monospace"
      }
    )

    //console.log(`Rendering target at ${Object.getOwnPropertyNames(evt_round_start)}`)
    this.targetRect = this.add.rectangle(
      evt_round_start.target.x * CELL + CELL / 2,
      evt_round_start.target.y * CELL + CELL / 2,
      CELL - 4, CELL - 4, 0xff3333
    )

    // right aligned
    this.countdown.setOrigin(1, 0)
    this.renderPlayers(evt_round_start.players)
  }

  handleRoundTick(evt_round_tick) {
    const time_left_sec = Math.floor(evt_round_tick.time_left / 1000)
    console.log(`time left: ${time_left_sec}`)
    this.countdown.setText(time_left_sec.toString())
  }

  handleGameStart() {
    // Logic to handle game start
    console.log("Game started")
    this.GameEngineFSM.handleEvent("ready_to_host")
  }

  handlePlyerPositionsUpdate(evt_player_positions_update) {
    this.renderPlayers(evt_player_positions_update.players)
  }

  processGameEvt(evt, evtData) {
    switch (evt) {
      case Events.GAME_START:
        this.handleGameStart()
        break
      case Events.ROUND_START: // Evt_RoundStart
        this.handleRoundStart(evtData)
        break
      case Events.ROUND_END: // Evt_RoundEnd
        this.handleRoundEnd(evtData)
        break
      case Events.PLAYER_POSITIONS_UPDATE: // Evt_PlayerPositionsUpdate
        this.handlePlyerPositionsUpdate(evtData)
        break
      case Events.TIMER_TICK: // Evt_TimerTick
        this.handleRoundTick(evtData)
        break
      case Events.GAME_OVER: // Evt_GameOver
        this.handleGameOver(evtData)
        break
    }
  }


  onGameEvt(evt, evtData) {
    //console.log(`onGameEvt called evt: ${evt}, evtData: ${evtData}`)
    this.pendingEvents.push({evt, evtData})
  }


  drawGrid() {
    const g = this.add.graphics()
    g.lineStyle(1, 0x333333, 1)

    for (let x = 0; x <= GRID_W; x++) {
      g.lineBetween(x * CELL, 0, x * CELL, GRID_H * CELL)
    }

    for (let y = 0; y <= GRID_H; y++) {
      g.lineBetween(0, y * CELL, GRID_W * CELL, y * CELL)
    }
  }

  processPendingEvents() {
    while (this.pendingEvents.length > 0) {
      const {evt, evtData} = this.pendingEvents.shift()
      this.processGameEvt(evt, evtData)
    }
  }

  update(time, delta) {
    this.processPendingEvents()
  }

  renderPlayers(players) {
    players.forEach(p => {
      console.log(`Rendering player ${p.id} at (${p.position.x}, ${p.position.y})`)
      p.position.x = Phaser.Math.Clamp(p.position.x, 0, GRID_W - 1)
      p.position.y = Phaser.Math.Clamp(p.position.y, 0, GRID_H - 1)
      const r = this.playersRects[p.id]
      r.visible = p.alive
      if(!p.alive){
        console.log(`Player ${p.id} is eliminated, hiding rectangle`)
      }
      r.x = p.position.x * CELL + CELL / 2
      r.y = p.position.y * CELL + CELL / 2
      r.visible = p.alive
    })
  }
}
