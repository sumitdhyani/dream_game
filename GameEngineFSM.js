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
              logger,
              moveDelay)
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
              selfFsm,
              moveDelay)
  {
    super()
    this.gameEvtHandler     = gameEvtHandler
    this.players            = players
    this.activePlayers      = Array.from(players)
    this.eliminatedPlayers  = []
    this.self               = self
    this.targetGenerator    = targetGenerator
    this.selfFsm            = selfFsm
    this.moveDelay          = moveDelay
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
                            1,
                            this.moveDelay)
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
              roundNo,
              moveDelay)
  {
    super()
    this.gameEvtHandler             = gameEvtHandler
    this.players                    = players
    this.activePlayers              = activePlayers
    this.self                       = self
    this.eliminatedPlayers          = eliminatedPlayers
    this.targetGenerator            = targetGenerator
    this.roundLength                = roundLength
    this.timeLeft                   = roundLength
    this.timerId                    = null
    this.botTimerIds                = null
    this.selfFsm                    = selfFsm
    this.roundNo                    = roundNo
    this.target                     = this.targetGenerator()
    this.moveDelay                  = moveDelay
    this.lastMoveTimes              = {}
    this.activePlayers.forEach((player)=>{
      this.lastMoveTimes[player.id] = 0
    })
  }

  onEntry() {
    this.gameEvtHandler(Events.ROUND_START,
                        new Evt_RoundStart(this.roundNo,
                                           this.roundLength,
                                           this.activePlayers,
                                           this.target))
    
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

    const botPlayers = this.activePlayers.filter((player)=>{
      return player.id !== this.self.id
    })

    this.botTimerIds =
    botPlayers.map((botPlayer)=>{
                          return setInterval(() => {
                                              this.moveBot(botPlayer, this.target)},
                                              100)})
                            
  }


  beforeExit() {
    clearInterval(this.timerId)
    clearInterval(this.positionBroadcastTimerId)
    this.botTimerIds.forEach(botTimerId=>{
      clearInterval(botTimerId)
    })
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
                          this.roundNo,
                          this.target,
                          this.moveDelay)

  }

  moveBot(botPlayer, target) {

    if (Date.now() - this.lastMoveTimes[botPlayer.id] < this.moveDelay) {
      return
    }

    // 10% chance to move randomly (humanize behavior)
    if (Math.random() < 0.1) {
      // Random move
      const directions = [
        { x: 0, y: -1 },  // UP
        { x: 0, y: 1 },   // DOWN
        { x: -1, y: 0 },  // LEFT
        { x: 1, y: 0 }    // RIGHT
      ];
      const randomDir = directions[Math.floor(Math.random() * directions.length)];
      botPlayer.position.x += randomDir.x;
      botPlayer.position.y += randomDir.y;
    } else {
      // Move optimally towards target
      const dx = target.x - botPlayer.position.x;
      const dy = target.y - botPlayer.position.y;

      // Decide whether to move horizontally or vertically
      // Prioritize the axis with larger distance
      if (Math.abs(dx) > Math.abs(dy)) {
        // Move horizontally
        botPlayer.position.x += dx > 0 ? 1 : -1;
      } else {
        // Move vertically
        botPlayer.position.y += dy > 0 ? 1 : -1;
      }
    }

    this.lastMoveTimes[botPlayer.id] = Date.now()
    this.gameEvtHandler(Events.PLAYER_POSITIONS_UPDATE, new Evt_PlayerPositionsUpdate(this.activePlayers))
  }

  on_key_press(key) {
    if(!this.self.alive ||
       Date.now() - this.lastMoveTimes[this.self.id] < this.self.moveDelay)
    {
      return
    }
    
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

    this.lastMoveTimes[this.self.id] = Date.now()
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
              roundNo,
              target)
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
    this.selfFsm            = selfFsm
    this.roundNo            = roundNo
    this.target             = target
  }

  findFarthestPlayerIdxs() {
    console.log(`Active players: ${this.activePlayers.reduce((acc, player) => { return `${acc}|name: ${player.name}, pos: ${player.position.x}:${player.position.y}`},  "")}`)
    // Calculate distance for each player
    const distances = this.activePlayers.map((player, idx) => {
      const dx = player.position.x - this.target.x;
      const dy = player.position.y - this.target.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return { idx, distance };
    });

    // Find maximum distance
    const maxDistance = Math.max(...distances.map(d => d.distance));

    // Return indices of all players with maximum distance
    return distances
      .filter(d => d.distance === maxDistance)
      .map(d => d.idx);
  }

  findLoserIdx() {
    const farthesPlayerIdxs = this.findFarthestPlayerIdxs(this.activePlayers, this.target)
    return farthesPlayerIdxs[0]
    
  }

  eliminateLoser() {
    const loserIdx = this.findLoserIdx()
    const loserPlayer = this.activePlayers[loserIdx]
    loserPlayer.alive = false
    this.eliminatedPlayers.push(loserPlayer)
    this.activePlayers.splice(loserIdx, 1)
    return loserPlayer
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
                            this.roundNo + 1,
                            this.moveDelay)
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
    const game_summary = new GameSummary(this.roundNo, this.players, this.winner_player)
    this.gameEvtHandler(Events.GAME_OVER, new Evt_GameOver(game_summary))
  }
}