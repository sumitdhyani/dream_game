import {FSM, State} from './FSM.js'
export class GameeEngineFSM extends FSM
{
  constructor(gameEngine, players, self, target, logger)
  {
    super(() => new PreStart(gameEngine, players, self, target), logger)
    this.logger = logger
  }

  onUnconsumedEvt(exception) {
      this.logger.warn(`Unconsumed evt, errMessage: ${exception.message}`)
  }

}

class PreStart extends State
{
  constructor(gameEngine, players, self, target) {
    super()
    this.gameEngine = gameEngine
    this.players = players
    this.self = self
    this.target = target
  }

  onEntry() {
      this.gameEngine.startGame(this.players, this.self, this.target)
  }

  on_ready_to_host() {
      return new  Playing(this.gameEngine)
  }
}

class Playing extends State
{
  constructor(gameEngine) {
    super()
    this.gameEngine = gameEngine
  }

  onEntry(){
      this.gameEngine.onReadyToHost()
  }

  on_key_press(key){
      this.gameEngine.onKeyPress(key)
  }

  on_round_end() {
      return new BetweenRounds(this.gameEngine)
  }

  on_game_over() {
    return new GameOver(this.gameEngine)
  }
}

class BetweenRounds extends State
{
  constructor(gameEngine) {
      super()
      this.gameEngine = gameEngine
  }

  on_ready_to_host() {
      return new Playing(this.gameEngine)
  }
}

class GameOver extends State {
  constructor(gameEngine) {
    super()
    this.gameEngine = gameEngine
  }
}