export class Position {
  constructor(x, y) {
    this.x = x
    this.y = y
  }
}

export class Player {
  constructor(id, name, position, color) {
    this.id = id
    this.name = name
    this.position = position
    this.alive = true
    this.color = color
  }
}

export class Round {
  constructor(number, duration, players, target) {
    this.number = number
    this.duration = duration // in seconds
    this.time_left = duration
    this.players = players
    this.target = target
  }
}

export class Evt_GameStart {
  constructor(duration, players) {
    this.players = players
  }
}

export class Evt_RoundStart {
  constructor(round, duration, players, target) {
    this.round = round
    this.duration = duration
    this.players = players
    this.target = target
  }
}

export class RoundSummary {
  constructor(round_number, eliminated_player) {
    this.round_number = round_number
    this.eliminated_player = eliminated_player
  }
}

export class Evt_RoundEnd {
  constructor(roundSummary) {
    this.roundSummary = roundSummary
  }
}

export class GameSummary {
  constructor(total_rounds, players, winner) {
    this.total_rounds = total_rounds
    this.players = players
    this.winner = winner
  }
}

export class Evt_GameOver {
  constructor(game_summary) {
    this.game_summary = game_summary
  }
}

export class Evt_PlayerPositionsUpdate {
  constructor(players) {
    this.players = players
  }
}



export class Evt_TimerTick {
  constructor(time_left) {
    this.time_left = time_left
  }
}

export class Evt_SelfReachedTarget {
  constructor(player) {
    this.player = player
  }
}

export class Evt_SelfLeftTarget {
  constructor(player) {
    this.player = player
  }
}

export const Events = {
  GAME_START: 0,
  ROUND_START: 1,
  ROUND_END: 2,
  PLAYER_POSITIONS_UPDATE: 3,
  GAME_OVER: 4,
  TIMER_TICK: 5,
  READY_TO_HOST: 6,
  SELF_REACHED_TARGET: 7,
  SELF_LEFT_TARGET: 8
}

export const keyboardKeys = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3
}

export const CELL = 32
export const GRID_W = 40
export const GRID_H = 40