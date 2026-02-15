// =============================================================================
// WORMHOLE COUNT HEURISTICS
// =============================================================================

/**
 * Function signature for wormhole count strategies
 */
export type WormholeCountStrategy = (
    gridWidth: number,
    gridHeight: number,
    playerCount: number
) => number

/**
 * Count Strategy: Balanced
 * - Scales with grid size and player count
 * - Ensures reasonable density
 */
export const countStrategyBalanced: WormholeCountStrategy = (
    gridWidth: number,
    gridHeight: number,
    playerCount: number
): number => {
    const gridCells = gridWidth * gridHeight
    
    // Base: sqrt of grid area, scaled down
    const baseCount = Math.floor(Math.sqrt(gridCells) / 3)
    
    // More players = slightly more wormholes
    const playerBonus = Math.floor(playerCount / 2)
    
    // Density cap: no more than 1 wormhole per 20 cells (entrance + exit = 2 cells each)
    const densityCap = Math.floor(gridCells / 20)
    
    // Minimum 1, maximum by density
    return Math.max(1, Math.min(baseCount + playerBonus, densityCap))
}

/**
 * Count Strategy: Minimal
 * - Just enough to create one interesting choice
 * - Good for small grids or simple gameplay
 */
export const countStrategyMinimal: WormholeCountStrategy = (
    gridWidth: number,
    gridHeight: number,
    playerCount: number
): number => {
    const gridCells = gridWidth * gridHeight
    
    // 1 wormhole for small grids, 2 for larger
    if (gridCells < 50) return 1
    if (gridCells < 150) return 2
    return Math.min(3, Math.floor(playerCount / 2) + 1)
}

/**
 * Count Strategy: Fixed Ratio to Number of Players
 * - Scales the number of wormholes based on a fixed ratio of players
 * - Useful for maintaining consistent gameplay dynamics
 */
export const createPlayerRatioCountStrategy = (ratio: number): WormholeCountStrategy => {
    return (gridWidth: number, gridHeight: number, playerCount: number): number => {
        const gridCells = gridWidth * gridHeight
        const densityCap = Math.floor(gridCells / 15)
        
        return Math.max(1, Math.min(Math.floor(playerCount * ratio), densityCap))
    }
}

/**
 * Count Strategy: Chaos
 * - Many wormholes for chaotic gameplay
 * - High density, lots of options
 */
export const countStrategyChaos: WormholeCountStrategy = (
    gridWidth: number,
    gridHeight: number,
    playerCount: number
): number => {
    const gridCells = gridWidth * gridHeight
    
    // 1 wormhole per 10 cells, plus player bonus
    const base = Math.floor(gridCells / 10)
    const playerBonus = playerCount
    
    // Still cap at reasonable density
    const densityCap = Math.floor(gridCells / 8)
    
    return Math.max(2, Math.min(base + playerBonus, densityCap))
}

// /**
//  * Count Strategy: Adaptive
//  * - Uses indecision potential to decide
//  * - Adds wormholes only if they can achieve minimum indecision threshold
//  */
// export function createAdaptiveCountStrategy(minIndecisionThreshold: number): WormholeCountStrategy {
//     return (gridWidth: number, gridHeight: number, playerCount: number): number => {
//         const gridCells = gridWidth * gridHeight
        
//         // Start with base estimate
//         const maxPossible = Math.floor(gridCells / 15)
        
//         // Scale based on how "spread out" players likely are
//         // More players in larger grid = more potential for strategic wormholes
//         const spreadFactor = Math.sqrt(gridCells) / Math.max(playerCount, 1)
        
//         if (spreadFactor > 5) {
//             // Players spread out - more wormholes useful
//             return Math.min(maxPossible, Math.ceil(playerCount * 0.75))
//         } else if (spreadFactor > 2) {
//             // Moderate spread
//             return Math.min(maxPossible, Math.ceil(playerCount * 0.5))
//         } else {
//             // Tight grid - fewer wormholes needed
//             return Math.max(1, Math.floor(playerCount * 0.3))
//         }
//     }
// }