import { Events, keyboardKeys, Evt_GameStart, Evt_RoundStart, Evt_RoundEnd, Evt_GameOver, Evt_TimerTick } from "./GlobalGameReference.js"

// Make class capture keyboard events and manage game state
export class GameEngine
{
  constructor(gameEvtHandler) {
    this.gameEvtHandler = gameEvtHandler
    this.currentRound = 1
    this.timeToRoundEnd = 30000 // milliseconds
    this.roundTimerId = null
    this.roundTarget = null
    this.self = null
  }

  // List of players: Player[]
  startGame(players, self, target) {
    this.players = players
    this.self = self
    this.roundTarget = target

    setTimeout(() => {
      this.self = self
      this.gameEvtHandler(Events.GAME_START, new Evt_GameStart(
        this.timeToRoundEnd,
        players
      ))

      setTimeout(() => {
        this.handleRoundStart(this.currentRound, this.timeToRoundEnd, this.players)
      }, 0)
    }, 0)
  }

  handleRoundStart(round, duration, players) {
    if (this.roundTimerId) {
      clearInterval(this.roundTimerId)
    }

    this.gameEvtHandler(Events.ROUND_START, new Evt_RoundStart(
      round,
      duration,
      players,
      structuredClone(this.roundTarget)// Send copy of the target to avoid mutation issues
    ))

    this.setRoundTimer(duration)
  }

  handleRoundEnd() {

    
    // Logic to handle end of round
  }

  findEliminatedPlayer(oldPlayers, newPlayers) {
    const eliminatedPlayer = this.players
    for (let oldPlayer of oldPlayers) {
      const stillExists = newPlayers.find(p => p.id === oldPlayer.id)

      if (!stillExists) {
        return oldPlayer
      }
    }
    return null
  }

  setRoundTimer(duration) {
    this.timeToRoundEnd = duration
    this.repetetionInterval = setInterval(() => {
      if (this.timeToRoundEnd > 0) {
        this.timeToRoundEnd -= 1000
        this.gameEvtHandler(Events.TIMER_TICK, new Evt_TimerTick(this.timeToRoundEnd))
      }
      else {
        clearInterval(this.repetetionInterval)
      }
    }, 1000)
  }

  onKeyPress(key) {
    console.log(`Key pressed: ${key}`)
    switch(key) {
      case keyboardKeys.UP:
        // move player up
        this.self.position.y++
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

    // Generate random movements for other players
    newPositions = this.players.map(player => {
      if (player.id !== this.self.id) {
        // Randomly move other players
        const dx = Math.random() > 0.5 ? 1 : -1;
        const dy = Math.random() > 0.5 ? 1 : -1;
        player.x += dx
        player.y += dy
      }

      return player;
    });

    this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(newPositions))
  }

  startRound(round, duration, players) {
    this.gameEvtHandler(Events.ROUND_START, { round, duration, players })
  }

  endRound(round, eliminated_player) {
    this.gameEvtHandler(2, { round, eliminated_player })
  }

  updatePlayerPositions(round, players) {
    this.gameEvtHandler(3, { round, players })
  }

  endGame(winner_player, game_summary) {
    this.gameEvtHandler(4, { winner_player, game_summary })
  }
}