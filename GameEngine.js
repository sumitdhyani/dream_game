import { GRID_W,
         GRID_H,
         Events,
         GameSummary,
         keyboardKeys,
         Position,
         RoundSummary,
         Evt_GameStart,
         Evt_RoundStart,
         Evt_RoundEnd,
         Evt_GameOver,
         Evt_TimerTick,
         Evt_PlayerPositionsUpdate } from "./GlobalGameReference.js"

// Make class capture keyboard events and manage game state
export class GameEngine
{
  constructor(gameEvtHandler) {
    this.gameEvtHandler = gameEvtHandler

    // ================ State variables =======================
    this.currentRound = 1
    this.roundLength = 10000 // milliseconds
    this.timeToRoundEnd = this.roundLength // milliseconds
    this.roundTimerId = null
    this.roundTarget = null
    // =========================================================
    this.self = null
  }

  // List of players: Player[]
  startGame(players, self, target) {
    this.players = players
    this.activePlayers = Array.from(players)
    this.eliminatedPlayers = []
    this.self = self
    this.roundTarget = target

    setTimeout(() => {
      this.gameEvtHandler(Events.GAME_START, new Evt_GameStart(
        this.timeToRoundEnd,
        players
      ))
    }, 0)
  }

  onReadyToHost() {
    setTimeout(() => {
      this.handleRoundStart()
    }, 0)
  }

  handleRoundStart() {
    this.gameEvtHandler(Events.ROUND_START, new Evt_RoundStart(
      this.currentRound,
      this.roundLength,
      this.activePlayers,
      structuredClone(this.roundTarget)// Send copy of the target to avoid mutation issues
    ))

    this.timeToRoundEnd = this.roundLength
    this.setRoundTimer(this.timeToRoundEnd)
  }

  rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  findLoserIdx() {
    return this.rand(0, this.activePlayers.length - 1)
  }

  eliminateLoser() {
    const loserIdx = this.findLoserIdx()
    this.activePlayers[loserIdx].alive = false
    this.eliminatedPlayers.push(this.activePlayers[loserIdx])
    this.activePlayers.splice(loserIdx, 1)
    return this.eliminatedPlayers[this.eliminatedPlayers.length - 1]
  }

  handleRoundEnd() {
    const eliminatedPlayer = this.eliminateLoser()
    clearInterval(this.roundTimerId)
    //this.roundLength = 8000
    

    if (this.activePlayers.length === 1) {
      this.handleGameOver()
      return
    }

    this.roundTarget = new Position(
      Math.floor(Math.random() * GRID_W),
      Math.floor(Math.random() * GRID_H)
    )

    const roundSummary = new RoundSummary(this.currentRound, eliminatedPlayer)
    this.currentRound++
    this.gameEvtHandler(Events.ROUND_END, new Evt_RoundEnd(roundSummary)) 
    // Logic to handle end of round
  }

  handleGameOver() {
    const winner_player = this.activePlayers[0]
    const game_summary = new GameSummary(this.currentRound, this.players, winner_player)
    this.gameEvtHandler(Events.GAME_OVER, new Evt_GameOver(game_summary))
  }

  setRoundTimer(duration) {
    this.timeToRoundEnd = duration
    this.roundTimerId = setInterval(() => {
      if (this.timeToRoundEnd > 0) {
        this.timeToRoundEnd -= 1000
        this.gameEvtHandler(Events.TIMER_TICK, new Evt_TimerTick(this.timeToRoundEnd))
      }
      else {
        this.handleRoundEnd()
      }
    }, 1000)
  }

  onKeyPress(key) {
    if (this.self.alive) {
      console.log(`Key pressed: ${key}`)
      switch(key) {
        case keyboardKeys.UP:
          // move player up
          this.self.position.y--
          break

        case keyboardKeys.DOWN:
          // move player down
          this.self.position.y++
          break
        case keyboardKeys.LEFT:
          // move player left
          this.self.position.x--
          break
        case keyboardKeys.RIGHT:
          // move player right
          this.self.position.x++
          break 
      }
    }

    // Generate random movements for other players
    this.activePlayers.forEach(player => {
      if (player.id !== this.self.id) {
        // Randomly move other players
        const dx = Math.random() > 0.5 ? 1 : -1;
        const dy = Math.random() > 0.5 ? 1 : -1;
        player.position.x += dx
        player.position.y += dy
        console.log(`Auto-moving player ${player.name} to (${player.position.x}, ${player.position.y}), dx = ${dx}, dy = ${dy}`);
      }
    });
    this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))
  }
}