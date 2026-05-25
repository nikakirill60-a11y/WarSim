// ===== BOARD GEOMETRY & RENDERING =====

const HEX_SIZE = 22;
const CX = 270, CY = 270;

let canvas = null;
let ctx    = null;
let boardCells = {};  // id → cell object
let hoveredCell = null;

// ── Hex → pixel (pointy-top) ──
function hexToPx(q, r) {
  return {
    x: CX + HEX_SIZE * Math.sqrt(3) * (q + r * 0.5),
    y: CY + HEX_SIZE * 1.5 * r
  };
}

// ── Build the full star board ──
function buildBoard() {
  boardCells = {};

  function add(q, r, zone) {
    const id = `${q},${r}`;
    if (boardCells[id]) return;
    const p = hexToPx(q, r);
    boardCells[id] = { id, q, r, x: p.x, y: p.y, zone, unit: null, neighbors: [] };
  }

  // Center hexagon radius 4 (61 cells)
  for (let q = -4; q <= 4; q++) {
    const r1 = Math.max(-4, -q - 4);
    const r2 = Math.min(4, -q + 4);
    for (let r = r1; r <= r2; r++) add(q, r, 'center');
  }

  // p0 tip cells (top) + rotate 60° × 5 for others
  const p0 = [
    [0,-5],[1,-5],[2,-5],[3,-5],
    [0,-6],[1,-6],[2,-6],
    [0,-7],[1,-7],
    [0,-8]
  ];

  // Cube rotation 60° CW: (x,y,z) → (-z,-x,-y)  →  axial (q,r) → (-r-q, q)
  function rot60([q, r]) {
    // cube: x=q, z=r, y=-q-r
    // after rot: x'=-z=-r, y'=-x=-q, z'=-y=q+r → new axial: q'=x'=-r, r'=z'=q+r
    return [-r, q + r];
  }

  function rotateTip(cells, times) {
    return cells.map(c => {
      let cell = [...c];
      for (let i = 0; i < times; i++) cell = rot60(cell);
      return cell;
    });
  }

  for (let t = 0; t < 6; t++) {
    rotateTip(p0, t).forEach(([q, r]) => add(q, r, `p${t}`));
  }

  // Build neighbor lists
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
  Object.values(boardCells).forEach(cell => {
    cell.neighbors = dirs
      .map(([dq, dr]) => `${cell.q+dq},${cell.r+dr}`)
      .filter(id => boardCells[id]);
  });

  console.log('[Board] cells:', Object.keys(boardCells).length);
}

// ── Canvas init ──
function initCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  canvas.addEventListener('click',     onBoardClick);
  canvas.addEventListener('mousemove', onBoardHover);
  canvas.addEventListener('mouseleave',() => { hoveredCell = null; drawBoard(); });
}

function getCellAt(mx, my) {
  let closest = null, best = 16;
  Object.values(boardCells).forEach(c => {
    const d = Math.hypot(c.x - mx, c.y - my);
    if (d < best) { best = d; closest = c; }
  });
  return closest;
}

function canvasXY(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function onBoardHover(e) {
  const { x, y } = canvasXY(e);
  hoveredCell = getCellAt(x, y);
  drawBoard();
}

function onBoardClick(e) {
  const { x, y } = canvasXY(e);
  const cell = getCellAt(x, y);
  if (cell) handleCellClick(cell);
}

// ── Sync state → board ──
function syncBoardFromState() {
  Object.values(boardCells).forEach(c => c.unit = null);
  const b = State.gameState?.board || {};
  Object.entries(b).forEach(([id, unit]) => {
    if (boardCells[id]) boardCells[id].unit = unit;
  });
}

// ── Draw everything ──
function drawBoard() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dark bg
  ctx.fillStyle = '#0d0d20';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawLines();

  // Valid move highlights (under cells)
  if (State.actionMode && State.selectedUnit) drawValidHighlights();

  Object.values(boardCells).forEach(drawCell);
  Object.values(boardCells).forEach(c => { if (c.unit) drawUnit(c); });

  // Selection ring
  if (State.selectedUnit && boardCells[State.selectedUnit.id]) {
    const c = boardCells[State.selectedUnit.id];
    ctx.beginPath();
    ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  drawBases();
}

function drawLines() {
  // Get apex of each zone tip
  function apex(zone) {
    const cells = Object.values(boardCells).filter(c => c.zone === zone);
    if (!cells.length) return null;
    return cells.reduce((a, b) =>
      Math.hypot(a.x - CX, a.y - CY) > Math.hypot(b.x - CX, b.y - CY) ? a : b
    );
  }

  // Yellow triangle: p0, p2, p4
  const yPts = ['p0','p2','p4'].map(apex).filter(Boolean);
  if (yPts.length === 3) {
    ctx.beginPath();
    ctx.moveTo(yPts[0].x, yPts[0].y);
    yPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Purple triangle: p1, p3, p5
  const pPts = ['p1','p3','p5'].map(apex).filter(Boolean);
  if (pPts.length === 3) {
    ctx.beginPath();
    ctx.moveTo(pPts[0].x, pPts[0].y);
    pPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(180, 100, 255, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function drawCell(cell) {
  const isHov = hoveredCell?.id === cell.id;
  const base  = ZONE_COLORS[cell.zone] || '#aaa';

  ctx.beginPath();
  ctx.arc(cell.x, cell.y, 11, 0, Math.PI * 2);
  ctx.fillStyle = isHov ? lighten(base, 0.25) : base;
  ctx.fill();
  ctx.strokeStyle = isHov ? '#fff' : 'rgba(0,0,0,0.4)';
  ctx.lineWidth   = isHov ? 2 : 1;
  ctx.stroke();
}

function drawUnit(cell) {
  const unit   = cell.unit;
  const player = State.gameState?.players?.find(p => p.id === unit.owner);
  const color  = player ? PLAYER_COLORS[player.colorIdx] : '#fff';
  const card   = CARDS[unit.type];

  // Shadow
  ctx.beginPath();
  ctx.arc(cell.x + 1, cell.y + 2, 13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(cell.x, cell.y, 13, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Icon
  ctx.font = '11px Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#fff';
  ctx.fillText(card?.icon || '?', cell.x, cell.y);

  // HP bar
  const maxHp = card?.hp || 1;
  const ratio  = unit.hp / maxHp;
  ctx.fillStyle = '#222';
  ctx.fillRect(cell.x - 11, cell.y - 19, 22, 3);
  ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.25 ? '#f39c12' : '#e74c3c';
  ctx.fillRect(cell.x - 11, cell.y - 19, 22 * ratio, 3);

  // Dim if spent
  const isOwn = unit.owner === State.myPlayerId;
  if (isOwn && unit.moved && unit.attacked) {
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
  }
}

function drawValidHighlights() {
  const mode = State.actionMode;
  const src  = State.selectedUnit ? boardCells[State.selectedUnit.id] : null;

  if (mode === 'move' && src) {
    getReachable(src).forEach(id => {
      const c = boardCells[id];
      ctx.beginPath(); ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(78,205,196,0.35)'; ctx.fill();
      ctx.strokeStyle = '#4ecdc4'; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  if (mode === 'attack' && src) {
    src.neighbors.forEach(nid => {
      const nc = boardCells[nid];
      if (nc?.unit && nc.unit.owner !== State.myPlayerId) {
        ctx.beginPath(); ctx.arc(nc.x, nc.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(231,76,60,0.35)'; ctx.fill();
        ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.stroke();
      }
    });
  }

  if (mode === 'rocket_target') {
    Object.values(boardCells).forEach(c => {
      if (!src || c.id === src.id) return;
      ctx.beginPath(); ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,107,53,0.18)'; ctx.fill();
    });
    // Hover preview AoE
    if (hoveredCell) {
      [hoveredCell.id, ...hoveredCell.neighbors].forEach(id => {
        const c = boardCells[id];
        if (!c) return;
        ctx.beginPath(); ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(231,76,60,0.45)'; ctx.fill();
        ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.stroke();
      });
    }
  }

  if (mode === 'heli_line' && hoveredCell) {
    const yellowZones = ['p0','p2','p4','center'];
    const purpleZones = ['p1','p3','p5','center'];
    const zones = yellowZones.includes(hoveredCell.zone) ? yellowZones : purpleZones;
    const col   = zones === yellowZones ? 'rgba(255,215,0,0.4)' : 'rgba(180,100,255,0.4)';
    Object.values(boardCells).forEach(c => {
      if (zones.includes(c.zone)) {
        ctx.beginPath(); ctx.arc(c.x, c.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
    });
  }
}

function drawBases() {
  const gs = State.gameState;
  if (!gs) return;

  // Highlight base select zones
  if (gs.phase === 'base_select' && isMyTurn()) {
    const me = gs.players.find(p => p.id === State.myPlayerId);
    if (me && !gs.playerBases?.[State.myPlayerId]) {
      const myZone = `p${me.colorIdx}`;
      Object.values(boardCells).filter(c => c.zone === myZone).forEach(c => {
        ctx.beginPath(); ctx.arc(c.x, c.y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 3; ctx.stroke();
      });
    }
  }

  // Draw player base markers
  const bases = gs.playerBases || {};
  Object.entries(bases).forEach(([pid, cellId]) => {
    const c = boardCells[cellId];
    if (!c) return;
    const player = gs.players.find(p => p.id === pid);
    ctx.beginPath(); ctx.arc(c.x, c.y, 15, 0, Math.PI * 2);
    ctx.strokeStyle = player ? PLAYER_COLORS[player.colorIdx] : '#fff';
    ctx.lineWidth = 3; ctx.stroke();
    // Small flag
    ctx.fillStyle = player ? PLAYER_COLORS[player.colorIdx] : '#fff';
    ctx.font = '9px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏠', c.x, c.y - 18);
  });
}

// ── Reachability (BFS, range = 1) ──
function getReachable(srcCell, range = 1) {
  const visited = new Set([srcCell.id]);
  let frontier  = [srcCell.id];
  const result  = [];
  for (let step = 0; step < range; step++) {
    const next = [];
    frontier.forEach(id => {
      boardCells[id]?.neighbors.forEach(nid => {
        if (!visited.has(nid) && !boardCells[nid]?.unit) {
          visited.add(nid);
          next.push(nid);
          result.push(nid);
        }
      });
    });
    frontier = next;
  }
  return result;
}

// ── Color utils ──
function lighten(hex, amt) {
  if (!hex.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,r+amt*255)},${Math.min(255,g+amt*255)},${Math.min(255,b+amt*255)})`;
}