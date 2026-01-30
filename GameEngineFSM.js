import {FSM, State} from './FSM.js'
import {
  GRID_W,
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
  Evt_PlayerPositionsUpdate
} from "./GlobalGameReference.js"
export class GameEngineFSM extends FSM
{
  constructor(gameEvtHandler,
              players,
              self,
              targetGenerator,
              logger)
  {
    let initState = new PreStart(gameEvtHandler,
      players,
      self,
      targetGenerator,
      null)
    super(() => initState,
          logger)

    initState.selfFsm = this

    this.logger = logger
  }

  onUnconsumedEvt(exception) {
      this.logger.warn(`Unconsumed evt, errMessage: ${exception.message}`)
  }

}

class PreStart extends State
{
  // params
  // gameEvtHandler(function (Events, EVT_* class object)) -> void
  // players(list[Player]) 
  // self(Player)
  // target(Position)
  // targetGenerator(function() -> Position): 
  constructor(gameEvtHandler,
              players,
              self,
              targetGenerator,
              selfFsm)
  {
    super()
    this.gameEvtHandler     = gameEvtHandler
    this.players            = players
    this.activePlayers      = Array.from(players)
    this.eliminatedPlayers  = []
    this.self               = self
    this.targetGenerator    = targetGenerator
    this.selfFsm            = selfFsm
  }

  onEntry() {
    setTimeout(() => {
      this.gameEvtHandler(Events.GAME_START, new Evt_GameStart(
        this.timeToRoundEnd,
        this.activePlayers
      ))
    }, 0)
  }

  on_ready_to_host() {
    return new PlayingRound(this.gameEvtHandler,
                            this.players,
                            this.activePlayers,
                            this.eliminatedPlayers,
                            this.self,
                            this.targetGenerator,
                            10000,
                            this.selfFsm,
                            1)
  }
}

class PlayingRound extends State
{
  constructor(gameEvtHandler,
              players,
              activePlayers,
              eliminatedPlayers,
              self,
              targetGenerator,
              roundLength,
              selfFsm,
              roundNo)
  {
    super()
    this.gameEvtHandler     = gameEvtHandler
    this.players            = players
    this.activePlayers      = activePlayers
    this.self               = self
    this.eliminatedPlayers  = eliminatedPlayers
    this.targetGenerator    = targetGenerator
    this.roundLength        = roundLength
    this.timeLeft           = roundLength
    this.timerrId           = null
    this.selfFsm            = selfFsm
    this.roundNo            = roundNo
  }

  onEntry() {
    this.gameEvtHandler(Events.ROUND_START,
                        new Evt_RoundStart(this.roundNo,
                                           this.roundLength,
                                           this.activePlayers,
                                           this.targetGenerator()))
    
    this.timerId = setInterval(()=>{
      if (this.timeLeft > 0) {
        this.timeLeft -= 1000
        this.gameEvtHandler(Events.TIMER_TICK, new Evt_TimerTick(this.timeLeft))
      }
      else {
        setTimeout(()=>{
          console.log(`Signalling round end`)
          this.selfFsm.handleEvent("round_end")
        }, 0)
      }
    }, 1000)

  }

  beforeExit() {
    clearInterval(this.timerId)
  }

  on_round_end() {
    return new RoundEnded(this.gameEvtHandler,
                          this.players,
                          this.activePlayers,
                          this.self,
                          this.eliminatedPlayers,
                          this.targetGenerator,
                          this.roundLength,
                          this.selfFsm,
                          this.roundNo)

  }

  on_key_press(key) {
    if (this.self.alive) {
      //console.log(`Key pressed: ${key}`)
      switch (key) {
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
        //console.log(`Auto-moving player ${player.name} to (${player.position.x}, ${player.position.y}), dx = ${dx}, dy = ${dy}`);
      }
    });
    this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))
  }
}


class RoundEnded extends State
{
  constructor(gameEvtHandler,
              players,
              activePlayers,
              self,
              eliminatedPlayers,
              targetGenerator,
              roundLength,
              selfFsm,
              roundNo)
  {
    super()
    this.gameEvtHandler = gameEvtHandler
    this.players = players
    this.activePlayers = activePlayers
    this.self = self
    this.eliminatedPlayers = eliminatedPlayers
    this.targetGenerator = targetGenerator
    this.roundLength = roundLength
    this.timeLeft = roundLength
    this.selfFsm = selfFsm
    this.roundNo = roundNo
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

  on_launch() {
    const eliminatedPlayer = this.eliminateLoser()

    if (this.activePlayers.length === 1) {
      const winner_player = this.activePlayers[0]
      return new GameOver(this.gameEvtHandler, this.roundNo, this.players, winner_player)
    }


    const roundSummary = new RoundSummary(this.roundNo, eliminatedPlayer)
    this.gameEvtHandler(Events.ROUND_END, new Evt_RoundEnd(roundSummary))
  }

  on_ready_to_host() {
    return new PlayingRound(this.gameEvtHandler,
                            this.players,
                            this.activePlayers,
                            this.eliminatedPlayers,
                            this.self,
                            this.targetGenerator,
                            this.roundLength,
                            this.selfFsm,
                            this.roundNo + 1)
  }
}

class GameOver extends State {
  constructor(gameEvtHandler,
              roundNo,
              players,
              winner_player) {
    super()
    this.gameEvtHandler = gameEvtHandler
    this.roundNo        = roundNo
    this.players        = players
    this.winner_player  = winner_player
  }

  onEntry() {
    const game_summary = new GameSummary(this.currentRound, this.players, this.winner_player)
    this.gameEvtHandler(Events.GAME_OVER, new Evt_GameOver(game_summary))
  }
}