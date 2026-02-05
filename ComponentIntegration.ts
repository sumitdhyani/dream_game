// ComponentIntegration.ts
// Bridge Implementation Plan for decoupling GameRenderer and GameEngineFSM via NetworkInterface

/**
 * Bridge Implementation Plan
 *
 * Goal:
 *   Decouple GameRenderer and GameEngineFSM using ClientSideNWInterface and ServerSideNWInterface,
 *   enabling easy swap to real networking in the future.
 *
 * Steps:
 *
 * 1. Instantiate the Interfaces:
 *    - Create one instance of ClientSideNWInterface (for GameRenderer)
 *    - Create one instance of ServerSideNWInterface (for GameEngineFSM)
 *
 * 2. Define Registration Functions:
 *    - Provide registration functions for user input and game events to both interfaces.
 *    - These functions will wire the event flow between the two interfaces.
 *
 * 3. Wire the Bridge:
 *    - When GameRenderer sends user input via ClientSideNWInterface, forward it to ServerSideNWInterface.
 *    - When GameEngineFSM emits a game event via ServerSideNWInterface, forward it to ClientSideNWInterface.
 *
 * 4. Register Event Handlers:
 *    - GameRenderer registers a handler with ClientSideNWInterface to receive game events.
 *    - GameEngineFSM registers a handler with ServerSideNWInterface to receive user input.
 *
 * 5. Logging:
 *    - Pass a logger instance to both interfaces for debugging and tracing event flow.
 *
 * 6. Usage:
 *    - GameRenderer interacts only with ClientSideNWInterface.
 *    - GameEngineFSM interacts only with ServerSideNWInterface.
 *    - The bridge ensures all communication is routed through the interfaces, not direct calls.
 *
 * 7. Future Networking:
 *    - To enable real networking, replace the bridge wiring with actual network send/receive logic.
 *
 * Diagram:
 *
 *   [GameRenderer] <-> [ClientSideNWInterface] <==BRIDGE==> [ServerSideNWInterface] <-> [GameEngineFSM]
 *
 *   (All event and payload types remain type-safe and strictly defined)
 */

// Implementation of the bridge will follow this plan.

import { ClientSideNWInterface,
         ServerSideNWInterface,
         FGameEvtListener,
         FGameEventRegistrationListener,
         FGuiEventListener,
         FGuiEventRegistrationListener,
         Logger} from "./NetworkInterface.js";
import { EventType, GameEventPayload, GameEvtHandler, GRID_H, GRID_W, KeyboardKey, Player, Position } from "./GlobalGameReference.js";
import { use } from "matter";
import { GameEngineFSM } from "./GameEngineFSM.js";
import { Game } from "phaser";
import { GameRenderer } from "./GameRenderer.js";

// Simple console logger implementation
const logger : Logger = {
  info: (msg: string) => console.info(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
  debug: (msg: string) => console.debug(msg),
};


export function setupBridge(gameRenderer: GameRenderer) {
  let clientNW: ClientSideNWInterface | null = null;
  let serverNW: ServerSideNWInterface | null = null;

  clientNW = new ClientSideNWInterface(logger);
  serverNW = new ServerSideNWInterface(logger);

  gameRenderer.guiEvtListener = clientNW.onGuiEvent.bind(clientNW);
  clientNW.propagateGameEvt = gameRenderer.onGameEvt.bind(gameRenderer);

  clientNW.propagateGuiEvt = serverNW.onGuiEvent.bind(serverNW);
  serverNW.propagateGameEvt = clientNW.onGameEvt.bind(clientNW);

  


  const players = [
    new Player("1", "p1", new Position(1, 1), 0x00ff00),
    new Player("2", "p2", new Position(18, 2), 0x00aaff),
    new Player("3", "p3", new Position(5, 17), 0xffaa00),
    new Player("4", "p4", new Position(5, 17), 0xffffff)
  ]
  
  const gameEngineFSM: GameEngineFSM = new GameEngineFSM(serverNW.onGameEvt.bind(serverNW),
    players,
    players[0],
    () => {
      return new Position(Math.floor(Math.random() * GRID_W),
        Math.floor(Math.random() * GRID_H))
    },
    logger,
    100)

  serverNW.propagateGuiEvt = gameEngineFSM.handleEvent.bind(gameEngineFSM);
  gameEngineFSM.start()
}
// Usage:
// - GameRenderer uses clientNW and registers a handler with clientNW.registerGameEventHandler
// - GameEngineFSM uses serverNW and registers a handler with serverNW.registerGameEventHandler
// - All communication is routed through the bridge above