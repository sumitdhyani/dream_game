import { Position, Wormhole, GRID_W, GRID_H } from '../GlobalGameReference.js'


/**
 * Function signature for indecision strategies
 */
export type IndecisionStrategy = (
    playerScores: number[]
) => number


// =============================================================================
// AGGREGATION STRATEGIES
// =============================================================================

/**
 * Strategy: Average (Mean)
 * - Rewards wormholes good for most players
 * - Tolerates one player having obvious choice
 */
export const strategyAverage: IndecisionStrategy = (scores: number[]): number => {
    if (scores.length === 0) return 0
    return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

/**
 * Strategy: Minimum
 * - Ensures EVERY player faces a real choice
 * - Very strict, one outlier tanks the score
 */
export const strategyMinimum: IndecisionStrategy = (scores: number[]): number => {
    if (scores.length === 0) return 0
    return Math.min(...scores)
}

/**
 * Strategy: Geometric Mean
 * - Punishes zeros harshly but less extreme than min
 * - Good balance between "everyone cares" and practicality
 */
export const strategyGeometricMean: IndecisionStrategy = (scores: number[]): number => {
    if (scores.length === 0) return 0
    // Add small epsilon to avoid zero product
    const epsilon = 0.001
    const product = scores.reduce((prod, s) => prod * (s + epsilon), 1)
    return Math.pow(product, 1 / scores.length) - epsilon
}

/**
 * Strategy: Harmonic Mean
 * - Even more sensitive to low values than geometric mean
 * - Heavily penalizes any player with obvious choice
 */
export const strategyHarmonicMean: IndecisionStrategy = (scores: number[]): number => {
    if (scores.length === 0) return 0
    const epsilon = 0.001
    const sumReciprocals = scores.reduce((sum, s) => sum + 1 / (s + epsilon), 0)
    return scores.length / sumReciprocals - epsilon
}

// /**
//  * Strategy: Human-Centric Weighted
//  * - Prioritizes human player's indecision
//  * - Bots provide backdrop challenge
//  */
// export function createHumanCentricStrategy(humanWeight: number = 0.7): IndecisionStrategy {
//     return (scores: number[], players?: PlayerIndecisionData[]): number => {
//         if (scores.length === 0) return 0
        
//         // If no player metadata, fall back to average
//         if (!players || players.length !== scores.length) {
//             return strategyAverage(scores)
//         }
        
//         let humanScore = 0
//         let humanCount = 0
//         let botSum = 0
//         let botCount = 0
        
//         players.forEach((p, i) => {
//             if (p.isHuman) {
//                 humanScore += scores[i]
//                 humanCount++
//             } else {
//                 botSum += scores[i]
//                 botCount++
//             }
//         })
        
//         const avgHuman = humanCount > 0 ? humanScore / humanCount : 0
//         const avgBot = botCount > 0 ? botSum / botCount : 0
        
//         return humanWeight * avgHuman + (1 - humanWeight) * avgBot
//     }
// }

/**
 * Strategy: Median
 * - Robust to outliers
 * - Ensures at least half the players have good indecision
 */
export const strategyMedian: IndecisionStrategy = (scores: number[]): number => {
    if (scores.length === 0) return 0
    const sorted = [...scores].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2
    }
    return sorted[mid]
}

/**
 * Strategy: Soft Minimum (LogSumExp trick)
 * - Smooth approximation of minimum
 * - Parameter controls "softness" (higher = closer to true min)
 */
export function createSoftMinStrategy(temperature: number = 5): IndecisionStrategy {
    return (scores: number[]): number => {
        if (scores.length === 0) return 0
        // Soft-min using negative log-sum-exp
        const negScaled = scores.map(s => -temperature * s)
        const maxNeg = Math.max(...negScaled)
        const sumExp = negScaled.reduce((sum, x) => sum + Math.exp(x - maxNeg), 0)
        return -1 / temperature * (maxNeg + Math.log(sumExp))
    }
}

/**
 * Strategy: Variance-Penalized Average
 * - High average is good
 * - But penalize if variance is high (unfair distribution)
 */
export function createVariancePenalizedStrategy(variancePenalty: number = 0.5): IndecisionStrategy {
    return (scores: number[]): number => {
        if (scores.length === 0) return 0
        const avg = strategyAverage(scores)
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length
        return avg - variancePenalty * Math.sqrt(variance)
    }
}