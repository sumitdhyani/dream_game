import { Position, Wormhole, Player, WormholeGenerator } from '../GlobalGameReference.js'
import { strategyAverage, strategyMinimum, strategyGeometricMean, strategyHarmonicMean, strategyMedian, createSoftMinStrategy, createVariancePenalizedStrategy, IndecisionStrategy } from './IndecisionStrategy.js'
import {WormholeCountStrategy,
        countStrategyBalanced,
        countStrategyMinimal,
        countStrategyPerPlayer
     } from './CountStrategy.js'
/**
 * Player data needed for indecision calculation
 */
type PlayerIndecisionInput = {
    id: string
    position: Position
    // isHuman: boolean
}

type WormholeCandidate = {
    entrance: Position
    exit: Position
}
/**
 * Scored wormhole candidate
 */
type ScoredWormholeCandidate = {
    wormholeCandidate: WormholeCandidate
    score: number
    //playerScores: Record<string, number>  // individual scores for debugging
}

// =============================================================================
// DISTANCE UTILITIES
// =============================================================================

function manhattanDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

// =============================================================================
// CORE INDECISION CALCULATION
// =============================================================================

/**
 * Calculate indecision score for a single player given a wormhole.
 * Returns value in [0, 1] where 1 = maximum indecision (routes are equal)
 */
function playerIndecision(
    player: Position,
    target: Position,
    wormholeCandidate: WormholeCandidate
): number {
    const directRoute = manhattanDistance(player, target)
    const wormholeRoute = manhattanDistance(player, wormholeCandidate.entrance) + manhattanDistance(wormholeCandidate.exit, target)
    
    // Edge case: player is at target
    if (directRoute === 0) return 0
    
    // Wormhole is useless if exit isn't closer to target than entrance
    if (manhattanDistance(wormholeCandidate.exit, target) >= manhattanDistance(wormholeCandidate.entrance, target)) {
        return 0
    }
    
    const difference = Math.abs(directRoute - wormholeRoute)
    return 1 - (difference / Math.max(directRoute, wormholeRoute))
}

// =============================================================================
// WORMHOLE SCORING
// =============================================================================

/**
 * Score a wormhole candidate using a given strategy
 */
function scoreWormhole(
    wormholeCandidate: WormholeCandidate,
    target: Position,
    players: PlayerIndecisionInput[],
    strategy: IndecisionStrategy
): number {
    const playerScores: Record<string, number> = {}
    const scores: number[] = []
    
    players.forEach(p => {
        const score = playerIndecision(p.position, target, wormholeCandidate)
        playerScores[p.id] = score
        scores.push(score)
    })
    
    // For human-centric strategies, we need to pass player metadata
    // This is a slight hack - we attach it to the scores array
    const aggregateScore = (strategy as any).length > 1 
        ? (strategy as any)(scores, players)
        : strategy(scores);
    
    return aggregateScore;
}

const WORMHOLE_COLORS = [0x9933ff, 0x33ccff, 0xff6699, 0x66ff33, 0xff9933, 0x33ff99]

// =============================================================================
// MIN-HEAP FOR STREAMING TOP-K
// =============================================================================

/**
 * Min-heap that keeps the top K highest-scored candidates.
 * Uses a min-heap so we can efficiently evict the lowest score when full.
 * Memory: O(K) instead of O(W²H²)
 */
class TopKHeap {
    private heap: ScoredWormholeCandidate[] = []
    private readonly capacity: number

    constructor(k: number) {
        this.capacity = k
    }

    /** Returns current minimum score in heap (threshold for insertion) */
    get minScore(): number {
        return this.heap.length > 0 ? this.heap[0].score : -Infinity
    }

    get size(): number {
        return this.heap.length
    }

    /** Try to add a candidate. Only adds if score beats current minimum or heap not full. */
    tryAdd(candidate: ScoredWormholeCandidate): void {
        if (this.heap.length < this.capacity) {
            this.heap.push(candidate)
            this.bubbleUp(this.heap.length - 1)
        } else if (candidate.score > this.heap[0].score) {
            // Replace minimum with new candidate
            this.heap[0] = candidate
            this.bubbleDown(0)
        }
        // Otherwise discard - score too low
    }

    /** Extract all candidates sorted by score descending */
    extractSortedDesc(): ScoredWormholeCandidate[] {
        // Sort in place and return (heap property no longer needed)
        return this.heap.sort((a, b) => b.score - a.score)
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2)
            if (this.heap[parentIndex].score <= this.heap[index].score) break
            this.swap(parentIndex, index)
            index = parentIndex
        }
    }

    private bubbleDown(index: number): void {
        const length = this.heap.length
        while (true) {
            const leftChild = 2 * index + 1
            const rightChild = 2 * index + 2
            let smallest = index

            if (leftChild < length && this.heap[leftChild].score < this.heap[smallest].score) {
                smallest = leftChild
            }
            if (rightChild < length && this.heap[rightChild].score < this.heap[smallest].score) {
                smallest = rightChild
            }
            if (smallest === index) break
            this.swap(index, smallest)
            index = smallest
        }
    }

    private swap(i: number, j: number): void {
        const temp = this.heap[i]
        this.heap[i] = this.heap[j]
        this.heap[j] = temp
    }
}

// =============================================================================
// WORMHOLE GENERATION (STREAMING TOP-K)
// =============================================================================

/**
 * Multiplier for K in top-K heap. We keep more candidates than needed
 * to account for overlapping cells that get filtered out during selection.
 */
const TOP_K_MULTIPLIER = 5

/**
 * Stream wormhole candidates through a top-K heap.
 * Instead of storing all O(W²H²) candidates, we only keep the best K.
 * Memory: O(K) instead of O(W²H²)
 */
function streamCandidatesToTopK(
    gridWidth: number,
    gridHeight: number,
    target: Position,
    players: PlayerIndecisionInput[],
    strategy: IndecisionStrategy,
    maxWormholes: number
): ScoredWormholeCandidate[] {
    const occupied = new Set<string>()
    occupied.add(`${target.x},${target.y}`)
    players.forEach(p => occupied.add(`${p.position.x},${p.position.y}`))

    // Keep more candidates than needed to handle overlap filtering
    const heapCapacity = maxWormholes * TOP_K_MULTIPLIER
    const topK = new TopKHeap(heapCapacity)

    // Stream through all valid (entrance, exit) pairs
    for (let ex = 0; ex < gridWidth; ex++) {
        for (let ey = 0; ey < gridHeight; ey++) {
            if (occupied.has(`${ex},${ey}`)) continue
            
            const entranceToTarget = Math.abs(ex - target.x) + Math.abs(ey - target.y)

            for (let xx = 0; xx < gridWidth; xx++) {
                for (let xy = 0; xy < gridHeight; xy++) {
                    if (occupied.has(`${xx},${xy}`)) continue
                    if (ex === xx && ey === xy) continue

                    // Exit must be closer to target than entrance (inline check)
                    const exitToTarget = Math.abs(xx - target.x) + Math.abs(xy - target.y)
                    if (exitToTarget >= entranceToTarget) continue

                    const entrance = new Position(ex, ey)
                    const exit = new Position(xx, xy)
                    const candidate: WormholeCandidate = { entrance, exit }

                    // Score and try to add to heap
                    const score = scoreWormhole(candidate, target, players, strategy)
                    
                    // Early skip: if score can't beat current minimum, don't bother
                    if (topK.size >= heapCapacity && score <= topK.minScore) continue

                    topK.tryAdd({ wormholeCandidate: candidate, score })
                }
            }
        }
    }

    return topK.extractSortedDesc()
}

/**
 * Generate all valid wormhole candidates (legacy - kept for debug function)
 */
function generateCandidates(
    gridWidth: number,
    gridHeight: number,
    target: Position,
    players: PlayerIndecisionInput[]
): WormholeCandidate[] {
    const occupied = new Set<string>()
    occupied.add(`${target.x},${target.y}`)
    players.forEach(p => occupied.add(`${p.position.x},${p.position.y}`))
    
    const candidates: WormholeCandidate[] = []
    
    // Generate all valid (entrance, exit) pairs
    for (let ex = 0; ex < gridWidth; ex++) {
        for (let ey = 0; ey < gridHeight; ey++) {
            if (occupied.has(`${ex},${ey}`)) continue
            
            for (let xx = 0; xx < gridWidth; xx++) {
                for (let xy = 0; xy < gridHeight; xy++) {
                    if (occupied.has(`${xx},${xy}`)) continue
                    if (ex === xx && ey === xy) continue
                    
                    const entrance = new Position(ex, ey)
                    const exit = new Position(xx, xy)
                    
                    // Exit must be closer to target than entrance
                    if (manhattanDistance(exit, target) >= manhattanDistance(entrance, target)) {
                        continue
                    }
                    
                    candidates.push({ entrance, exit })
                }
            }
        }
    }
    
    return candidates
}

/**
 * Create a wormhole generator using a specific indecision strategy
 * Uses streaming top-K approach for O(K) memory instead of O(W²H²)
 */
export function wormHoleGeneratorFactory(strategy: IndecisionStrategy, countStrategy: WormholeCountStrategy): WormholeGenerator {
    
    return (
        gridWidth: number,
        gridHeight: number,
        target: Position,
        players: Player[]
    ): Wormhole[] => {
        const playerIndecisionInput: PlayerIndecisionInput[] = players.map(p => ({
            id: p.id,
            position: p.position,
            // isHuman: !(p instanceof BotPlayer)
        }))

        const maxWormholes = countStrategy(gridWidth, gridHeight, players.length)
        
        // Stream candidates through top-K heap instead of storing all
        const scoredWormHoles = streamCandidatesToTopK(
            gridWidth,
            gridHeight,
            target,
            playerIndecisionInput,
            strategy,
            maxWormholes
        )
        
        // Select top non-overlapping wormholes
        const selected: Wormhole[] = []
        const usedCells = new Set<string>()
        
        for (const s of scoredWormHoles) {
            if (selected.length >= maxWormholes) break
            
            const entranceKey = `${s.wormholeCandidate.entrance.x},${s.wormholeCandidate.entrance.y}`
            const exitKey = `${s.wormholeCandidate.exit.x},${s.wormholeCandidate.exit.y}`
            
            if (usedCells.has(entranceKey) || usedCells.has(exitKey)) {
                continue
            }
            
            usedCells.add(entranceKey)
            usedCells.add(exitKey)
            
            //Generate a randon uuid string
            // Assign color
            selected.push(new Wormhole(
                Math.random().toString(36).substring(2, 10),
                s.wormholeCandidate.entrance,
                s.wormholeCandidate.exit,
                WORMHOLE_COLORS[selected.length % WORMHOLE_COLORS.length]
            ))
        }
        
        return selected
    }
}

// =============================================================================
// PRE-BUILT GENERATORS (for easy injection)
// =============================================================================

// export const generateWormholesAverage = wormHoleGeneratorFactory(strategyAverage, countStrategyBalanced)
// export const generateWormholesMinimum = wormHoleGeneratorFactory(strategyMinimum, countStrategyMinimal)
// export const generateWormholesGeometric = wormHoleGeneratorFactory(strategyGeometricMean, countStrategyPerPlayer)
// export const generateWormholesHarmonic = wormHoleGeneratorFactory(strategyHarmonicMean, countStrategyPerPlayer)
// export const generateWormholesMedian = wormHoleGeneratorFactory(strategyMedian, countStrategyBalanced)
// export const generateWormholesSoftMin = wormHoleGeneratorFactory(createSoftMinStrategy(5), countStrategyBalanced)
// export const generateWormholesVariancePenalized = wormHoleGeneratorFactory(createVariancePenalizedStrategy(0.5), countStrategyBalanced)

// =============================================================================
// DEBUG / VISUALIZATION HELPER
// =============================================================================

/**
 * Get detailed scoring info for debugging
 */
export function debugWormholeScoring(
    gridWidth: number,
    gridHeight: number,
    target: Position,
    players: Player[],
    indecisionStrategies: { name: string; strategy: IndecisionStrategy }[],
    countStrategies     : { name: string; strategy: WormholeCountStrategy }[],
): void {
    const candidates = generateCandidates(gridWidth, gridHeight, target, players)
    
    console.log(`=== Wormhole Indecision Debug ===`)
    console.log(`Grid: ${gridWidth}x${gridHeight}`)
    console.log(`Target: (${target.x}, ${target.y})`)
    console.log(`Players: ${players.map(p => `${p.id}@(${p.position.x},${p.position.y})`).join(', ')}`)
    console.log(`Candidates: ${candidates.length}`)
    console.log(``)

    indecisionStrategies.forEach(({ name, strategy }) => {
        countStrategies.forEach(({ name: countName, strategy: countStrategy }) => {
            const generator = wormHoleGeneratorFactory(strategy, countStrategy)
            const wormholes = generator(gridWidth, gridHeight, target, players)
            
            console.log(`Indecision Strategy: ${name} | Count Strategy: ${countName}`)
            wormholes.forEach((w, i) => {
                const score = scoreWormhole({entrance: w.entrance, exit: w.exit}, target, players, strategy)
                console.log(`  Wormhole ${i + 1}: (${w.entrance.x},${w.entrance.y}) → (${w.exit.x},${w.exit.y})`)
                console.log(`    Score: ${score.toFixed(3)}`)
                //console.log(`    Per-player: ${Object.entries(scored.playerScores).map(([id, s]) => `${id}=${s.toFixed(2)}`).join(', ')}`)
            })
            console.log(``)
        })
    })
}