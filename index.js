
import { GoogleGenAI, Type } from "@google/genai";

// --- Configuration ---
const GRID_SIZE = 4;
const CELL_SIZE = 64;

// --- State Management ---
let gameState = createInitialState(GRID_SIZE, GRID_SIZE);
let isAiThinking = false;

function createInitialState(rows, cols) {
    return {
        rows,
        cols,
        horizontalLines: Array(rows + 1).fill(null).map(() => Array(cols).fill(false)),
        verticalLines: Array(rows).fill(null).map(() => Array(cols + 1).fill(false)),
        squares: Array(rows).fill(null).map(() => Array(cols).fill(null)),
        currentPlayer: 'PLAYER_1', // PLAYER_1 (Human), PLAYER_2 (AI)
        scores: { PLAYER_1: 0, PLAYER_2: 0 },
        isGameOver: false,
        moveCount: 0
    };
}

/**
 * Validates if a square at [r, c] is complete.
 */
function checkSquareCompletion(r, c) {
    if (r < 0 || r >= gameState.rows || c < 0 || c >= gameState.cols) return false;
    if (gameState.squares[r][c] !== null) return false;
    
    const top = gameState.horizontalLines[r][c];
    const bottom = gameState.horizontalLines[r + 1][c];
    const left = gameState.verticalLines[r][c];
    const right = gameState.verticalLines[r][c + 1];
    
    return top && bottom && left && right;
}

/**
 * Helper to count sides of a square at [r, c]
 */
function getSquareSideCount(r, c) {
    if (r < 0 || r >= gameState.rows || c < 0 || c >= gameState.cols) return -1;
    let sides = 0;
    if (gameState.horizontalLines[r][c]) sides++;
    if (gameState.horizontalLines[r + 1][c]) sides++;
    if (gameState.verticalLines[r][c]) sides++;
    if (gameState.verticalLines[r][c + 1]) sides++;
    return sides;
}

// --- Game Logic ---
function handleMove(type, r, c) {
    if (gameState.isGameOver) return;
    
    const isH = type === 'h';
    const lines = isH ? gameState.horizontalLines : gameState.verticalLines;

    if (isH) {
        if (r < 0 || r > gameState.rows || c < 0 || c >= gameState.cols || lines[r][c]) return;
    } else {
        if (r < 0 || r >= gameState.rows || c < 0 || c > gameState.cols || lines[r][c]) return;
    }

    lines[r][c] = true;
    gameState.moveCount++;

    let completedAny = false;
    const squaresToCheck = isH ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]];

    for (const [sqR, sqC] of squaresToCheck) {
        if (checkSquareCompletion(sqR, sqC)) {
            gameState.squares[sqR][sqC] = gameState.currentPlayer;
            gameState.scores[gameState.currentPlayer] += 1;
            completedAny = true;
        }
    }

    if (!completedAny) {
        gameState.currentPlayer = gameState.currentPlayer === 'PLAYER_1' ? 'PLAYER_2' : 'PLAYER_1';
    }

    gameState.isGameOver = gameState.squares.every(row => row.every(sq => sq !== null));
    render();
    
    if (gameState.currentPlayer === 'PLAYER_2' && !gameState.isGameOver && !isAiThinking) {
        setTimeout(triggerAi, 300);
    }
}

// --- Gemini AI Strategy Logic ---
async function fetchAiMove() {
    // Safety check for API Key availability
    const key = process.env.API_KEY;
    if (!key || key === '') {
        console.warn("API Key missing. Using local strategic engine.");
        return null; // Trigger fallback
    }

    const ai = new GoogleGenAI({ apiKey: key });
    
    const availableMoves = [];
    for(let r=0; r<=gameState.rows; r++) for(let c=0; c<gameState.cols; c++) 
        if(!gameState.horizontalLines[r][c]) availableMoves.push({type:'h', r, c});
    for(let r=0; r<gameState.rows; r++) for(let c=0; c<=gameState.cols; c++) 
        if(!gameState.verticalLines[r][c]) availableMoves.push({type:'v', r, c});

    if (availableMoves.length === 0) return null;

    const squareStats = [];
    for(let r=0; r<gameState.rows; r++) {
        for(let c=0; c<gameState.cols; c++) {
            if (gameState.squares[r][c]) continue;
            squareStats.push({r, c, sides: getSquareSideCount(r, c)});
        }
    }

    const prompt = `Dots & Squares. Grid ${gameState.rows}x${gameState.cols}. 
BOARD ANALYSIS (Current square side counts):
${JSON.stringify(squareStats)}

STRATEGY:
1. If a square has 3 sides, COMPLETE it.
2. Avoid placing a 3rd side (which lets opponent score).
Return JSON: {"type": "h"|"v", "r": int, "c": int}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 800 },
                temperature: 0,
                maxOutputTokens: 500, 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        type: { type: Type.STRING, enum: ['h', 'v'] },
                        r: { type: Type.INTEGER },
                        c: { type: Type.INTEGER }
                    },
                    required: ["type", "r", "c"]
                }
            }
        });

        const move = JSON.parse(response.text);
        const lines = move.type === 'h' ? gameState.horizontalLines : gameState.verticalLines;
        if (lines[move.r] && lines[move.r][move.c] === false) return move;
        return null;
    } catch (e) {
        console.error("Gemini API Error:", e);
        return null;
    }
}

async function triggerAi() {
    if (isAiThinking) return;
    isAiThinking = true;
    render();

    let move = null;
    try {
        move = await fetchAiMove();
    } catch (e) {}

    // LOCAL STRATEGIC FALLBACK (Always kicks in if Gemini fails or Key is missing)
    if (!move) {
        const moves = [];
        for(let r=0; r<=gameState.rows; r++) for(let c=0; c<gameState.cols; c++) 
            if(!gameState.horizontalLines[r][c]) moves.push({type:'h', r, c});
        for(let r=0; r<gameState.rows; r++) for(let c=0; c<=gameState.cols; c++) 
            if(!gameState.verticalLines[r][c]) moves.push({type:'v', r, c});

        // 1. Try to find a move that completes a square
        for (const m of moves) {
            const isH = m.type === 'h';
            const squares = isH ? [[m.r - 1, m.c], [m.r, m.c]] : [[m.r, m.c - 1], [m.r, m.c]];
            for (const [sqR, sqC] of squares) {
                if (getSquareSideCount(sqR, sqC) === 3) {
                    move = m;
                    break;
                }
            }
            if (move) break;
        }

        // 2. Otherwise pick one that doesn't create a 3rd side
        if (!move) {
            const safeMoves = moves.filter(m => {
                const isH = m.type === 'h';
                const squares = isH ? [[m.r - 1, m.c], [m.r, m.c]] : [[m.r, m.c - 1], [m.r, m.c]];
                return squares.every(([sqR, sqC]) => getSquareSideCount(sqR, sqC) < 2);
            });
            move = safeMoves.length > 0 ? safeMoves[Math.floor(Math.random() * safeMoves.length)] : moves[0];
        }
    }

    isAiThinking = false;
    if (move) handleMove(move.type, move.r, move.c);
}

// --- Rendering Engine ---
const gridEl = document.getElementById('game-grid');

function render() {
    document.getElementById('val-p1').innerText = gameState.scores.PLAYER_1;
    document.getElementById('val-p2').innerText = gameState.scores.PLAYER_2;
    
    const isP1 = gameState.currentPlayer === 'PLAYER_1';
    document.getElementById('score-p1').className = `p-6 rounded-3xl border-2 transition-all duration-300 ${isP1 ? 'border-blue-500 bg-white shadow-xl scale-105' : 'border-slate-100 bg-slate-50 opacity-60'}`;
    document.getElementById('score-p2').className = `p-6 rounded-3xl border-2 transition-all duration-300 ${!isP1 ? 'border-indigo-500 bg-white shadow-xl scale-105' : 'border-slate-100 bg-slate-50 opacity-60'}`;
    
    document.getElementById('turn-p1').style.display = (isP1 && !gameState.isGameOver) ? 'flex' : 'none';
    const turnP2 = document.getElementById('turn-p2');
    turnP2.style.display = (!isP1 && !gameState.isGameOver) ? 'flex' : 'none';
    turnP2.innerText = isAiThinking ? "AI Thinking..." : "AI Taking Turn...";

    const hasCheckpoint = !!localStorage.getItem('dots_game_v1');
    const restoreBtn = document.getElementById('btn-restore');
    restoreBtn.disabled = !hasCheckpoint;
    restoreBtn.className = `p-1.5 rounded-lg transition-all ${hasCheckpoint ? 'text-slate-600 hover:text-blue-600' : 'text-slate-200 cursor-not-allowed'}`;

    gridEl.style.width = `${gameState.cols * CELL_SIZE}px`;
    gridEl.style.height = `${gameState.rows * CELL_SIZE}px`;
    
    let html = '';
    
    // 1. Render Captured Squares
    gameState.squares.forEach((row, r) => row.forEach((owner, c) => {
        if (owner) {
            html += `<div class="absolute w-[64px] h-[64px] flex items-center justify-center transition-all duration-500 animate-in zoom-in-50 ${owner === 'PLAYER_1' ? 'bg-blue-50/40' : 'bg-indigo-50/40'}" style="top:${r*CELL_SIZE}px; left:${c*CELL_SIZE}px;"><div class="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shadow-sm bg-${owner === 'PLAYER_1' ? 'blue' : 'indigo'}-500 text-white">${owner === 'PLAYER_1' ? 'P' : 'A'}</div></div>`;
        }
    }));

    // 2. Render Lines
    gameState.horizontalLines.forEach((row, r) => row.forEach((active, c) => {
        const canClick = !active && isP1 && !isAiThinking && !gameState.isGameOver;
        html += `<button class="line-btn line-h absolute h-1.5 z-20 transition-all rounded-full ${active ? 'bg-slate-800' : 'bg-slate-100 hover:bg-slate-300'}" style="width:64px; top:${r*CELL_SIZE-3}px; left:${c*CELL_SIZE}px" onclick="window.makeMove('h', ${r}, ${c})" ${!canClick ? 'disabled' : ''}></button>`;
    }));

    gameState.verticalLines.forEach((row, r) => row.forEach((active, c) => {
        const canClick = !active && isP1 && !isAiThinking && !gameState.isGameOver;
        html += `<button class="line-btn line-v absolute w-1.5 z-20 transition-all rounded-full ${active ? 'bg-slate-800' : 'bg-slate-100 hover:bg-slate-300'}" style="height:64px; top:${r*CELL_SIZE}px; left:${c*CELL_SIZE-3}px" onclick="window.makeMove('v', ${r}, ${c})" ${!canClick ? 'disabled' : ''}></button>`;
    }));

    // 3. Render Dots
    for(let r=0; r<=gameState.rows; r++) {
        for(let c=0; c<=gameState.cols; c++) {
            html += `<div class="absolute w-3 h-3 bg-slate-300 rounded-full z-30 border-2 border-white shadow-sm" style="top:${r*CELL_SIZE-6}px; left:${c*CELL_SIZE-6}px"></div>`;
        }
    }
    
    gridEl.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
    if (gameState.isGameOver) showGameOver();
}

window.makeMove = (type, r, c) => handleMove(type, r, c);

document.getElementById('btn-reset').onclick = () => {
    if (confirm("Start a new game?")) {
        gameState = createInitialState(GRID_SIZE, GRID_SIZE);
        isAiThinking = false;
        hideModals();
        render();
    }
};

document.getElementById('btn-play-again').onclick = () => {
    gameState = createInitialState(GRID_SIZE, GRID_SIZE);
    isAiThinking = false;
    hideModals();
    render();
};

document.getElementById('btn-save').onclick = () => {
    localStorage.setItem('dots_game_v1', JSON.stringify(gameState));
};

document.getElementById('btn-restore').onclick = () => {
    const saved = localStorage.getItem('dots_game_v1');
    if (saved) {
        gameState = JSON.parse(saved);
        isAiThinking = false;
        render();
    }
};

const helpModal = document.getElementById('modal-help');
document.getElementById('btn-help').onclick = () => helpModal.style.display = 'flex';
document.getElementById('close-help').onclick = () => helpModal.style.display = 'none';
document.getElementById('close-help-btn').onclick = () => helpModal.style.display = 'none';

function showGameOver() {
    const winnerText = document.getElementById('winner-text');
    if (gameState.scores.PLAYER_1 > gameState.scores.PLAYER_2) {
        winnerText.innerText = 'You Won!';
        winnerText.className = 'text-3xl font-black text-blue-600';
    } else if (gameState.scores.PLAYER_1 < gameState.scores.PLAYER_2) {
        winnerText.innerText = 'AI Wins!';
        winnerText.className = 'text-3xl font-black text-indigo-600';
    } else {
        winnerText.innerText = "It's a Tie!";
        winnerText.className = 'text-3xl font-black text-slate-600';
    }
    document.getElementById('final-score').innerText = `Final Score: ${gameState.scores.PLAYER_1} - ${gameState.scores.PLAYER_2}`;
    document.getElementById('modal-gameover').style.display = 'flex';
}

function hideModals() {
    document.getElementById('modal-gameover').style.display = 'none';
    helpModal.style.display = 'none';
}

render();
