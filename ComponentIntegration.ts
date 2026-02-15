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
         Logger,
         FGuiEventListener} from "./NetworkInterface.js";
import { BotPlayer, WormholeGenerator } from "./GlobalGameReference.js";
import { use } from "matter";
import { GameEngineFSM } from "./GameEngineFSM.js";
import { Game } from "phaser";
import { GameRenderer } from "./GameRenderer.js";
import { TargetSelectors } from "./TargetSelectors.js";
import { BotClient, createSimpleBotAI } from "./BotClient.js";
import { wormHoleGeneratorFactory } from "./WormholeGeneration/WormholeCreationStrategies.js";

import { WormholeCountStrategy, 
         countStrategyBalanced,
         countStrategyMinimal,
         createPlayerRatioCountStrategy } from "./WormholeGeneration/CountStrategy.js";
         
import { IndecisionStrategy,
         strategyAverage,
         strategyGeometricMean,
         strategyHarmonicMean,
        strategyMedian,
        strategyMinimum,
        createVariancePenalizedStrategy,
        createSoftMinStrategy } from "./WormholeGeneration/IndecisionStrategy.js";

import { WormHoleConstraints, createWormholeConstraints } from "./GlobalGameReference.js";

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
  const botClients: BotClient[] = [];

  clientNW = new ClientSideNWInterface(logger);
  serverNW = new ServerSideNWInterface(logger);

  gameRenderer.guiEvtListener = clientNW.onGuiEvent.bind(clientNW);
  clientNW.gameEventEmitter.register(gameRenderer.onGameEvt.bind(gameRenderer));

  // Factory to create BotClients when game starts
  gameRenderer.botClientFactory = (botPlayers: BotPlayer[], guiEvtSender: FGuiEventListener) => {
    // Clear any existing bot clients
    botClients.forEach(bc => {
      clientNW.gameEventEmitter.unregister(bc.onGameEvt.bind(bc));
      bc.destroy();
    });
    botClients.length = 0;

    // Create a BotClient for each bot player
    botPlayers.forEach(botPlayer => {
      const botClient = new BotClient(
        botPlayer,
        guiEvtSender,
        createSimpleBotAI(0.1), // 10% random moves
        60 // think interval ms
      );
      
      // Register to receive game events
      clientNW.gameEventEmitter.register(botClient.onGameEvt.bind(botClient));
      botClients.push(botClient);
    });

    logger.info(`Created ${botClients.length} BotClients`);
  };

  clientNW.propagateGuiEvt = serverNW.onGuiEvent.bind(serverNW);
  serverNW.propagateGameEvt = clientNW.onGameEvt.bind(clientNW);
  
  const gameEngineFSM: GameEngineFSM = new GameEngineFSM(serverNW.onGameEvt.bind(serverNW),
    TargetSelectors.hybrid,
    wormHoleGeneratorFactory(strategyAverage, createPlayerRatioCountStrategy(2), 
      createWormholeConstraints({
        lengthMin: 10,
        lengthMax: 30,
        maxDistanceToTarget: 15,
        maxDistanceFromPlayers: 10,
      })
    ),
    logger)

  serverNW.propagateGuiEvt = gameEngineFSM.handleEvent.bind(gameEngineFSM);
  gameEngineFSM.start()
}

// Usage:
// - GameRenderer uses clientNW and registers a handler with clientNW.registerGameEventHandler
// - GameEngineFSM uses serverNW and registers a handler with serverNW.registerGameEventHandler
// - All communication is routed through the bridge above