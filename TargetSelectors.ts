// ============================================================================
// Target Selectors - Different strategies for selecting the next round target
// ============================================================================

import { GRID_W, GRID_H, Player, Position } from "./GlobalGameReference.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Context provided to target selectors for making decisions
 */
export interface TargetSelectorContext {
    activePlayers: Player[]
    eliminatedPlayer: Player | null
    roundNumber: number
    previousTarget: Position | null
}

/**
 * Function type for target selectors
 * Takes context about the game state and returns the next target position
 */
export type TargetSelector = (context: TargetSelectorContext) => Position

// ============================================================================
// Utility Functions
// ============================================================================

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function distanceBetween(a: Position, b: Position): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))
}

function calculateCentroid(players: Player[]): Position {
    if (players.length === 0) {
        return new Position(GRID_W / 2, GRID_H / 2)
    }
    const sumX = players.reduce((sum, p) => sum + p.position.x, 0)
    const sumY = players.reduce((sum, p) => sum + p.position.y, 0)
    return new Position(sumX / players.length, sumY / players.length)
}

function getRandomPosition(): Position {
    return new Position(
        Math.floor(Math.random() * GRID_W),
        Math.floor(Math.random() * GRID_H)
    )
}

function getFarthestCorner(fromX: number, fromY: number): Position {
    const corners = [
        new Position(0, 0),
        new Position(GRID_W - 1, 0),
        new Position(0, GRID_H - 1),
        new Position(GRID_W - 1, GRID_H - 1)
    ]
    
    let farthest = corners[0]
    let maxDistance = 0
    
    for (const corner of corners) {
        const dist = distanceBetween(corner, new Position(fromX, fromY))
        if (dist > maxDistance) {
            maxDistance = dist
            farthest = corner
        }
    }
    
    return farthest
}

// ============================================================================
// Selector Implementations
// ============================================================================

/**
 * APPROACH 0: Pure Random
 * Simply picks a random position on the grid.
 * 
 * Pros: Simple, unpredictable
 * Cons: Can place target very close to players (trivial rounds)
 */
export function pureRandomSelector(_context: TargetSelectorContext): Position {
    return getRandomPosition()
}

/**
 * APPROACH 1: Eliminated Player Position (Original)
 * Uses the eliminated player's last position as the next target.
 * Falls back to random if no player was eliminated.
 * 
 * Pros: Thematic connection to elimination
 * Cons: Can cause clustering problem if all players are near target
 */
export function eliminatedPlayerPositionSelector(context: TargetSelectorContext): Position {
    if (context.eliminatedPlayer) {
        return new Position(
            context.eliminatedPlayer.position.x,
            context.eliminatedPlayer.position.y
        )
    }
    return getRandomPosition()
}

/**
 * APPROACH 2: Minimum Distance from Centroid
 * Target must be at least MIN_DISTANCE away from the average position of all players.
 * 
 * Pros: Guarantees meaningful travel distance
 * Cons: Can feel arbitrary
 */
export function createMinDistanceFromCentroidSelector(minDistance: number = 15): TargetSelector {
    return (context: TargetSelectorContext): Position => {
        const centroid = calculateCentroid(context.activePlayers)
        
        let attempts = 0
        while (attempts < 100) {
            const candidate = getRandomPosition()
            const distance = distanceBetween(candidate, centroid)
            if (distance >= minDistance) {
                return candidate
            }
            attempts++
        }
        
        // Fallback: return farthest corner from centroid
        return getFarthestCorner(centroid.x, centroid.y)
    }
}

/**
 * APPROACH 3: Opposite Quadrant
 * Target appears in the quadrant opposite to where most players are clustered.
 * 
 * Pros: Predictable pattern, strategic depth
 * Cons: Players can game the system by spreading out
 */
export function oppositeQuadrantSelector(context: TargetSelectorContext): Position {
    const midX = GRID_W / 2
    const midY = GRID_H / 2
    
    // Count players in each quadrant
    const quadrantCounts = { NW: 0, NE: 0, SW: 0, SE: 0 }
    
    for (const player of context.activePlayers) {
        const pos = player.position
        if (pos.x < midX && pos.y < midY) quadrantCounts.NW++
        else if (pos.x >= midX && pos.y < midY) quadrantCounts.NE++
        else if (pos.x < midX && pos.y >= midY) quadrantCounts.SW++
        else quadrantCounts.SE++
    }
    
    // Find most populated quadrant
    const entries = Object.entries(quadrantCounts) as [keyof typeof quadrantCounts, number][]
    const mostPopulated = entries.sort((a, b) => b[1] - a[1])[0][0]
    
    // Get opposite quadrant
    const oppositeMap: Record<string, { xMin: number, xMax: number, yMin: number, yMax: number }> = {
        NW: { xMin: midX, xMax: GRID_W - 1, yMin: midY, yMax: GRID_H - 1 },  // SE
        NE: { xMin: 0, xMax: midX - 1, yMin: midY, yMax: GRID_H - 1 },       // SW
        SW: { xMin: midX, xMax: GRID_W - 1, yMin: 0, yMax: midY - 1 },       // NE
        SE: { xMin: 0, xMax: midX - 1, yMin: 0, yMax: midY - 1 }             // NW
    }
    
    const bounds = oppositeMap[mostPopulated]
    return new Position(
        Math.floor(bounds.xMin + Math.random() * (bounds.xMax - bounds.xMin + 1)),
        Math.floor(bounds.yMin + Math.random() * (bounds.yMax - bounds.yMin + 1))
    )
}

/**
 * APPROACH 4: Dynamic MinDistance (Scales with Round)
 * MinDistance increases each round, forcing longer races as game progresses.
 * 
 * Pros: Tension increases naturally
 * Cons: May feel unfair in later rounds
 */
export function createDynamicMinDistanceSelector(
    baseDistance: number = 10,
    maxDistance: number = 25,
    totalRounds: number = 10
): TargetSelector {
    return (context: TargetSelectorContext): Position => {
        const progress = Math.min(context.roundNumber / totalRounds, 1)
        const minDistance = baseDistance + (maxDistance - baseDistance) * progress
        
        const centroid = calculateCentroid(context.activePlayers)
        
        let attempts = 0
        while (attempts < 100) {
            const candidate = getRandomPosition()
            const distance = distanceBetween(candidate, centroid)
            if (distance >= minDistance) {
                return candidate
            }
            attempts++
        }
        
        return getFarthestCorner(centroid.x, centroid.y)
    }
}

/**
 * APPROACH 5: Eliminated Player Opposite Position
 * Target appears at the grid-opposite of the eliminated player's position.
 * 
 * Pros: Thematic + guaranteed distance
 * Cons: Very predictable
 */
export function eliminatedPlayerOppositeSelector(context: TargetSelectorContext): Position {
    if (context.eliminatedPlayer) {
        return new Position(
            GRID_W - 1 - context.eliminatedPlayer.position.x,
            GRID_H - 1 - context.eliminatedPlayer.position.y
        )
    }
    return getRandomPosition()
}

/**
 * APPROACH 6: Hybrid (Target→Loser Direction + MinDistance Check)
 * Uses eliminated player's position if it's far enough from centroid,
 * otherwise extends in the previousTarget → loser direction to ensure
 * meaningful travel distance. This creates natural "sweeping" map coverage.
 * 
 * Pros: Thematic continuity, natural map exploration, rewards positioning
 * Cons: More complex logic
 */
export function createHybridSelector(minDistance: number = 15): TargetSelector {
    return (context: TargetSelectorContext): Position => {
        const centroid = calculateCentroid(context.activePlayers)
        
        // If there's an eliminated player, try their position first
        if (context.eliminatedPlayer) {
            const eliminatedPos = context.eliminatedPlayer.position
            const distanceFromCentroid = distanceBetween(eliminatedPos, centroid)
            
          console.log(`minDIstance: ${minDistance}, distanceFromCentroid: ${distanceFromCentroid}`)
            if (distanceFromCentroid >= minDistance) {
                // Eliminated player's position is valid
                return new Position(eliminatedPos.x, eliminatedPos.y)
            } else {
                // Extend in the direction of previousTarget → loser
                // This creates natural "sweeping" movement across the map
                let dx: number, dy: number
                
                if (context.previousTarget) {
                    // Primary: use previousTarget → loser direction
                    dx = eliminatedPos.x - context.previousTarget.x
                    dy = eliminatedPos.y - context.previousTarget.y
                } else {
                    // Fallback for round 1: use centroid → loser direction
                    dx = eliminatedPos.x - centroid.x
                    dy = eliminatedPos.y - centroid.y
                }
                
                const magnitude = Math.sqrt(dx * dx + dy * dy)
                
                if (magnitude > 0) {
                    const normalizedX = dx / magnitude
                    const normalizedY = dy / magnitude
                    
                    // Extend from loser position in the same direction
                    return new Position(
                        clamp(Math.round(eliminatedPos.x + normalizedX * minDistance), 0, GRID_W - 1),
                        clamp(Math.round(eliminatedPos.y + normalizedY * minDistance), 0, GRID_H - 1)
                    )
                }
            }
        }
        
        // Fallback: use minimum distance from centroid
        return createMinDistanceFromCentroidSelector(minDistance)(context)
    }
}

// ============================================================================
// Default Export - Commonly used selectors
// ============================================================================

export const TargetSelectors = {
    pureRandom: pureRandomSelector,
    eliminatedPlayerPosition: eliminatedPlayerPositionSelector,
    minDistanceFromCentroid: createMinDistanceFromCentroidSelector(),
    oppositeQuadrant: oppositeQuadrantSelector,
    dynamicMinDistance: createDynamicMinDistanceSelector(),
    eliminatedPlayerOpposite: eliminatedPlayerOppositeSelector,
    hybrid: createHybridSelector()
}
