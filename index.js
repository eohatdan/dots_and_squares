
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

// --- Game Logic ---
function handleMove(type, r, c) {
    if (gameState.isGameOver) return;
    if (isAiThinking && gameState.currentPlayer === 'PLAYER_1') return;

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

    squaresToCheck.forEach(([sqR, sqC]) => {
        if (checkSquareCompletion(sqR, sqC)) {
            gameState.squares[sqR][sqC] = gameState.currentPlayer;
            gameState.scores[gameState.currentPlayer] += 1;
            completedAny = true;
        }
    });

    if (!completedAny) {
        gameState.currentPlayer = gameState.currentPlayer === 'PLAYER_1' ? 'PLAYER_2' : 'PLAYER_1';
    }

    gameState.isGameOver = gameState.squares.every(row => row.every(sq => sq !== null));
    render();
    
    if (gameState.currentPlayer === 'PLAYER_2' && !gameState.isGameOver && !isAiThinking) {
        triggerAi();
    }
}

function checkSquareCompletion(r, c) {
    if (r < 0 || r >= gameState.rows || c < 0 || c >= gameState.cols) return false;
    if (gameState.squares[r][c] !== null) return false;
    
    const top = gameState.horizontalLines[r][c];
    const bottom = gameState.horizontalLines[r + 1][c];
    const left = gameState.verticalLines[r][c];
    const right = gameState.verticalLines[r][c + 1];
    
    return top && bottom && left && right;
}

// --- Gemini AI Logic ---
async function fetchAiMove(retryCount = 0) {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const availableMoves = [];
    for(let r=0; r<=gameState.rows; r++) for(let c=0; c<gameState.cols; c++) 
        if(!gameState.horizontalLines[r][c]) availableMoves.push({type:'h', r, c});
    for(let r=0; r<gameState.rows; r++) for(let c=0; c<=gameState.cols; c++) 
        if(!gameState.verticalLines[r][c]) availableMoves.push({type:'v', r, c});

    if (availableMoves.length === 0) return null;

    // Compact representation to save tokens and speed up inference
    const hCompact = gameState.horizontalLines.map(row => row.map(v => v ? 1 : 0));
    const vCompact = gameState.verticalLines.map(row => row.map(v => v ? 1 : 0));

    const prompt = `Dots and Squares game. 
Board: Horizontal lines (1=exists): ${JSON.stringify(hCompact)}. Vertical lines (1=exists): ${JSON.stringify(vCompact)}.
Strategy:
1. COMPLETE any square with 3 sides.
2. DO NOT create a 3rd side for your opponent unless forced.
Moves available: ${JSON.stringify(availableMoves.slice(0, 35))}. 
Return JSON move.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                // Reduced thinking budget for faster response while keeping intelligence
                thinkingConfig: { thinkingBudget: 1000 },
                temperature: 0,
                maxOutputTokens: 1200, 
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
        
        if (lines[move.r] && lines[move.r][move.c] === false) {
            return move;
        } else {
            return availableMoves[0];
        }
    } catch (e) {
        if (retryCount < 1) return fetchAiMove(retryCount + 1);
        throw e;
    }
}

async function triggerAi() {
    isAiThinking = true;
    render();

    try {
        const move = await fetchAiMove();
        isAiThinking = false;
        if (move) {
            handleMove(move.type, move.r, move.c);
        }
    } catch (e) {
        console.error("AI Error:", e);
        isAiThinking = false;
        const moves = [];
        for(let r=0; r<=gameState.rows; r++) for(let c=0; c<gameState.cols; c++) 
            if(!gameState.horizontalLines[r][c]) moves.push({type:'h', r, c});
        for(let r=0; r<gameState.rows; r++) for(let c=0; c<=gameState.cols; c++) 
            if(!gameState.verticalLines[r][c]) moves.push({type:'v', r, c});
        if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            handleMove(randomMove.type, randomMove.r, randomMove.c);
        }
    }
}

// --- Rendering ---
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
    gameState.squares.forEach((row, r) => row.forEach((owner, c) => {
        if (owner) {
            html += `<div class="absolute w-[64px] h-[64px] flex items-center justify-center transition-all duration-700 animate-in fade-in zoom-in-75 ${owner === 'PLAYER_1' ? 'bg-blue-50/50' : 'bg-indigo-50/50'}" style="top:${r*CELL_SIZE}px; left:${c*CELL_SIZE}px;"><div class="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shadow-sm bg-${owner === 'PLAYER_1' ? 'blue' : 'indigo'}-500 text-white">${owner === 'PLAYER_1' ? 'P' : 'A'}</div></div>`;
        }
    }));

    gameState.horizontalLines.forEach((row, r) => row.forEach((active, c) => {
        const canClick = !active && isP1 && !isAiThinking && !gameState.isGameOver;
        html += `<button class="line-btn line-h absolute h-1.5 z-20 transition-all rounded-full ${active ? 'bg-slate-800 shadow-sm' : 'bg-slate-100 hover:bg-slate-300'}" style="width:64px; top:${r*CELL_SIZE-3}px; left:${c*CELL_SIZE}px" onclick="window.makeMove('h', ${r}, ${c})" ${!canClick ? 'disabled' : ''}></button>`;
    }));

    gameState.verticalLines.forEach((row, r) => row.forEach((active, c) => {
        const canClick = !active && isP1 && !isAiThinking && !gameState.isGameOver;
        html += `<button class="line-btn line-v absolute w-1.5 z-20 transition-all rounded-full ${active ? 'bg-slate-800 shadow-sm' : 'bg-slate-100 hover:bg-slate-300'}" style="height:64px; top:${r*CELL_SIZE}px; left:${c*CELL_SIZE-3}px" onclick="window.makeMove('v', ${r}, ${c})" ${!canClick ? 'disabled' : ''}></button>`;
    }));

    for(let r=0; r<=gameState.rows; r++) {
        for(let c=0; c<=gameState.cols; c++) {
            html += `<div class="absolute w-3.5 h-3.5 bg-slate-300 rounded-full z-30 border-2 border-white shadow-sm ring-1 ring-slate-100" style="top:${r*CELL_SIZE-7}px; left:${c*CELL_SIZE-7}px"></div>`;
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
    render();
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
