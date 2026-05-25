// ===== GAME LOGIC =====

// ── Helpers ──
function isMyTurn() {
  const gs = State.gameState;
  if (!gs || State.myPlayerId === null) return false;
  return gs.players[gs.turn]?.id === State.myPlayerId;
}

function getMyPlayer() {
  return State.gameState?.players?.find(p => p.id === State.myPlayerId);
}

// ── Initial game state ──
function createInitialGameState(players) {
  return {
    turn: 0,
    phase: 'base_select',
    players: players.map(p => ({ ...p, juice: 0 })),
    board: {},
    playerBases: {},
    log: ['🎮 Игра началась! Выберите базу.'],
    winner: null,
    pendingSix: 0,
    boughtThisTurn: [],
    spawnQueue: [],
    lastSpin: null,
  };
}

// ── Supabase update ──
async function pushGameState(newState) {
  State.gameState = newState;
  syncBoardFromState();
  updateTurnUI();
  renderLog();
  drawBoard();
  await sb.from('game_rooms').update({ game_state: newState }).eq('id', State.currentRoom.id);
}

// ── Cell click dispatcher ──
function handleCellClick(cell) {
  const gs = State.gameState;
  if (!gs) return;

  if (!isMyTurn()) {
    showToast('Сейчас не ваш ход!'); return;
  }

  if (gs.phase === 'base_select') { selectBase(cell); return; }
  if (gs.phase === 'spawn')       { trySpawnUnit(cell); return; }

  if (gs.phase === 'move') {
    const mode = State.actionMode;
    if (mode === 'move')          { tryMoveUnit(cell); return; }
    if (mode === 'attack')        { tryAttack(cell); return; }
    if (mode === 'rocket_target') { tryRocketAttack(cell); return; }
    if (mode === 'heli_line')     { tryHeliAttack(cell); return; }

    // Select own unit
    if (cell.unit?.owner === State.myPlayerId) {
      if (!cell.unit.moved || !cell.unit.attacked) {
        State.selectedUnit = cell;
        showUnitActions(cell);
      } else {
        showToast('Юнит уже действовал в этот ход');
      }
    }
  }
}

// ── Base selection ──
async function selectBase(cell) {
  const gs = State.gameState;
  const me = getMyPlayer();
  if (!me) return;

  const myZone = `p${me.colorIdx}`;
  if (cell.zone !== myZone) {
    showToast('Выберите клетку в своей зоне!'); return;
  }

  const ns = deepCopy(gs);
  ns.playerBases = ns.playerBases || {};
  ns.playerBases[State.myPlayerId] = cell.id;

  addLog(`🏠 ${me.username} выбрал базу`);

  // Advance turn to next player without base, or start game
  const allDone = ns.players.every(p => ns.playerBases[p.id]);
  if (allDone) {
    ns.phase = 'spin';
    ns.turn  = 0;
    addLog('🎲 Игра началась! Ход первого игрока.');
  } else {
    let next = (ns.turn + 1) % ns.players.length;
    while (ns.playerBases[ns.players[next].id]) {
      next = (next + 1) % ns.players.length;
    }
    ns.turn = next;
  }

  await pushGameState(ns);
}

// ── Roulette ──
async function spinRoulette() {
  const gs = State.gameState;
  if (!isMyTurn() || gs.phase !== 'spin' || State.spinning) return;

  State.spinning = true;
  document.getElementById('spinBtn').disabled = true;

  const result = Math.floor(Math.random() * 6) + 1;

  // Animate wheel
  const extra = 3 + Math.random() * 3;
  State.rotationDeg += 360 * extra + (result - 1) * 60;
  document.getElementById('rouletteWheel').style.transform =
    `rotate(${State.rotationDeg}deg)`;

  setTimeout(async () => {
    State.spinning = false;
    document.getElementById('rouletteNum').textContent    = result;
    document.getElementById('rouletteResult').textContent = `+${result} 🧃`;

    const ns    = deepCopy(gs);
    const myIdx = ns.players.findIndex(p => p.id === State.myPlayerId);

    if (result === 6) {
      ns.players[myIdx].juice = (ns.players[myIdx].juice || 0) + 6;

      if (ns.pendingSix === 1) {
        // Double six → elite pawn!
        ns.boughtThisTurn = [...(ns.boughtThisTurn || []), 'elitepawn'];
        ns.spawnQueue     = [...(ns.spawnQueue || []), 'elitepawn'];
        ns.pendingSix = 0;
        ns.phase = 'buy';
        addLog(`🎉 ${getMyPlayer()?.username} выбил двойную шестёрку — Элитная пешка!`);
        showToast('🎉 ДВОЙНАЯ ШЕСТЁРКА! Элитная пешка!', '#f1c40f');
        await pushGameState(ns);
      } else {
        ns.pendingSix = 1;
        addLog(`🎲 ${getMyPlayer()?.username} выбил 6 — крутит ещё раз!`);
        showToast('🎲 Шестёрка! Крутите ещё раз!', '#f1c40f');
        await pushGameState(ns);
        // Re-enable spin
        document.getElementById('spinBtn').disabled = false;
      }
      return;
    }

    // Normal
    ns.players[myIdx].juice = (ns.players[myIdx].juice || 0) + result;
    ns.pendingSix     = 0;
    ns.phase          = 'buy';
    ns.boughtThisTurn = [];
    ns.lastSpin       = result;
    addLog(`🎲 ${getMyPlayer()?.username} выбил ${result} 🧃`);
    await pushGameState(ns);
  }, 2300);
}

// ── Shop ──
function selectShopCard(cardId) {
  if (!isMyTurn() || State.gameState?.phase !== 'buy') return;
  State.selectedCard = State.selectedCard === cardId ? null : cardId;
  renderShop();
  updateBuyBtn();
}

async function buyCard() {
  const gs = State.gameState;
  if (!isMyTurn() || !State.selectedCard || gs.phase !== 'buy') return;

  const card = CARDS[State.selectedCard];
  const me   = getMyPlayer();
  if (!me || (me.juice || 0) < card.cost) { showToast('Недостаточно сока! 🧃'); return; }

  const ns    = deepCopy(gs);
  const myIdx = ns.players.findIndex(p => p.id === State.myPlayerId);
  ns.players[myIdx].juice -= card.cost;
  ns.boughtThisTurn = [...(ns.boughtThisTurn || []), State.selectedCard];
  ns.spawnQueue     = [...(ns.spawnQueue || []), State.selectedCard];

  addLog(`🛒 ${me.username} купил ${card.name} (${card.icon})`);
  State.selectedCard = null;
  await pushGameState(ns);
}

// ── End turn ──
async function endTurn() {
  const gs = State.gameState;
  if (!isMyTurn()) return;

  const ns = deepCopy(gs);

  if (ns.phase === 'buy') {
    ns.phase = (ns.spawnQueue?.length > 0) ? 'spawn' : 'move';
    if (ns.phase === 'move') resetUnitActions(ns);
    await pushGameState(ns);
    if (ns.phase === 'spawn') showToast('📍 Кликните на клетку своей зоны для размещения юнита');
    return;
  }

  if (ns.phase === 'spawn') {
    ns.spawnQueue = [];
    ns.phase = 'move';
    resetUnitActions(ns);
    await pushGameState(ns);
    return;
  }

  if (ns.phase === 'move') {
    const nextTurn = (ns.turn + 1) % ns.players.length;
    ns.turn           = nextTurn;
    ns.phase          = 'spin';
    ns.boughtThisTurn = [];
    ns.spawnQueue     = [];
    ns.pendingSix     = 0;
    ns.lastSpin       = null;
    addLog(`→ Ход: ${ns.players[nextTurn]?.username}`);
    await pushGameState(ns);
  }
}

function resetUnitActions(state) {
  Object.values(state.board || {}).forEach(u => {
    u.moved   = false;
    u.attacked= false;
  });
}

// ── Spawn ──
async function trySpawnUnit(cell) {
  const gs = State.gameState;
  if (!isMyTurn() || gs.phase !== 'spawn') return;
  if (!(gs.spawnQueue?.length)) { showToast('Нечего размещать'); return; }
  if (cell.unit) { showToast('Клетка занята!'); return; }

  const me     = getMyPlayer();
  const myZone = `p${me.colorIdx}`;

  // Allow spawning in own tip zone or adjacent center cells
  if (cell.zone !== myZone && cell.zone !== 'center') {
    showToast('Расставляйте юнитов в своей зоне!'); return;
  }

  const cardId = gs.spawnQueue[0];
  const card   = CARDS[cardId];
  const ns     = deepCopy(gs);
  const uid    = `u_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

  ns.board[cell.id] = {
    id: uid, type: cardId, owner: State.myPlayerId,
    hp: card.hp, maxHp: card.hp, damage: card.damage,
    moved: false, attacked: false
  };
  ns.spawnQueue.splice(0, 1);

  addLog(`📍 ${me.username} разместил ${card.name}`);
  await pushGameState(ns);

  if (ns.spawnQueue.length === 0) {
    showToast('Все юниты размещены! Нажмите «Завершить ход»');
  }
}

// ── Unit action modal ──
function showUnitActions(cell) {
  const unit = cell.unit;
  const card = CARDS[unit.type];

  const canMove   = !unit.moved;
  const canAttack = !unit.attacked;

  showModal(`
    <h2>${card.icon} ${card.name}</h2>
    <p>❤️ ${unit.hp}/${unit.maxHp} &nbsp;|&nbsp; ⚔️ ${unit.damage} урона</p>
    <div style="margin-top:14px">
      ${canMove    ? `<button class="action-btn action-move"   onclick="startMove('${cell.id}')">🚶 Переместить</button>` : ''}
      ${canAttack && card.special !== 'line_kill' && card.special !== 'aoe'
                   ? `<button class="action-btn action-attack" onclick="startAttack('${cell.id}')">⚔️ Атаковать</button>` : ''}
      ${canAttack && card.special === 'aoe'
                   ? `<button class="action-btn action-rocket" onclick="startRocket('${cell.id}')">🎯 Выстрел ракетой</button>` : ''}
      ${canAttack && card.special === 'line_kill'
                   ? `<button class="action-btn action-heli"   onclick="startHeli('${cell.id}')">🚁 Удар вертолётом</button>` : ''}
      <button class="action-btn action-cancel" onclick="cancelAction()">Отмена</button>
    </div>
  `);
}

function startMove(cellId) {
  closeModal();
  State.selectedUnit = boardCells[cellId];
  State.actionMode   = 'move';
  setBoardHint('Кликните на синюю клетку для перемещения (Esc — отмена)');
  drawBoard();
}

function startAttack(cellId) {
  closeModal();
  State.selectedUnit = boardCells[cellId];
  State.actionMode   = 'attack';
  setBoardHint('Кликните на красную клетку с врагом для атаки (Esc — отмена)');
  drawBoard();
}

function startRocket(cellId) {
  closeModal();
  State.selectedUnit = boardCells[cellId];
  State.actionMode   = 'rocket_target';
  setBoardHint('Ракета: выберите цель. Взрыв убьёт всех в радиусе 1 клетки.');
  drawBoard();
}

function startHeli(cellId) {
  closeModal();
  State.selectedUnit = boardCells[cellId];
  State.actionMode   = 'heli_line';
  setBoardHint('Вертолёт: кликните на зону — убьёт всю линию вместе со своими!');
  drawBoard();
}

function cancelAction() {
  closeModal();
  State.actionMode   = null;
  State.selectedUnit = null;
  setBoardHint('');
  drawBoard();
}

// Escape to cancel
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelAction();
});

// ── Move ──
async function tryMoveUnit(targetCell) {
  const src = State.selectedUnit;
  if (!src) return cancelAction();

  if (targetCell.unit) { showToast('Клетка занята!'); return; }
  if (!getReachable(boardCells[src.id]).includes(targetCell.id)) {
    showToast('Нельзя переместиться туда!'); return;
  }

  const ns   = deepCopy(State.gameState);
  const unit = ns.board[src.id];
  unit.moved = true;
  delete ns.board[src.id];
  ns.board[targetCell.id] = unit;

  // Pawn territory bonus
  const me = ns.players.find(p => p.id === State.myPlayerId);
  if (me && ['pawn','bigpawn','elitepawn'].includes(unit.type)) {
    const myZone = `p${me.colorIdx}`;
    if (targetCell.zone !== 'center' && targetCell.zone !== myZone) {
      me.juice = (me.juice || 0) + 1;
      addLog(`🎁 Пешка на вражеской территории! +1 🧃`);
    }
  }

  addLog(`🚶 Юнит перемещён`);
  cancelAction();
  await pushGameState(ns);
}

// ── Attack ──
async function tryAttack(targetCell) {
  const src = State.selectedUnit;
  if (!src) return cancelAction();
  if (!targetCell.unit)                             { showToast('Нет цели'); cancelAction(); return; }
  if (targetCell.unit.owner === State.myPlayerId)   { showToast('Нельзя атаковать своих!'); return; }
  if (!boardCells[src.id]?.neighbors.includes(targetCell.id)) {
    showToast('Слишком далеко!'); return;
  }

  const ns  = deepCopy(State.gameState);
  const att = ns.board[src.id];
  const def = ns.board[targetCell.id];
  if (!att || !def) return cancelAction();

  def.hp -= att.damage;
  att.attacked = true;
  addLog(`⚔️ ${CARDS[att.type]?.name} атакует ${CARDS[def.type]?.name} → ${def.hp}/${def.maxHp} HP`);

  if (def.hp <= 0) {
    delete ns.board[targetCell.id];
    addLog(`💀 ${CARDS[def.type]?.name} уничтожен!`);
  }

  checkWin(ns);
  cancelAction();
  await pushGameState(ns);
}

// ── Rocket ──
async function tryRocketAttack(targetCell) {
  const src = State.selectedUnit;
  if (!src) return cancelAction();

  const ns  = deepCopy(State.gameState);
  const att = ns.board[src.id];
  if (!att) return cancelAction();
  att.attacked = true;

  const targets = [targetCell.id, ...targetCell.neighbors];
  let kills = 0;
  targets.forEach(id => {
    if (ns.board[id]) {
      ns.board[id].hp -= att.damage;
      if (ns.board[id].hp <= 0) { delete ns.board[id]; kills++; }
    }
  });
  addLog(`🎯 Ракета! Уничтожено: ${kills}`);

  checkWin(ns);
  cancelAction();
  await pushGameState(ns);
}

// ── Helicopter ──
async function tryHeliAttack(targetCell) {
  const src = State.selectedUnit;
  if (!src) return cancelAction();

  const yellowZones = ['p0','p2','p4','center'];
  const purpleZones = ['p1','p3','p5','center'];
  const zones = yellowZones.includes(targetCell.zone) ? yellowZones : purpleZones;
  const lineName = zones === yellowZones ? 'жёлтую' : 'фиолетовую';

  const ns  = deepCopy(State.gameState);
  const att = ns.board[src.id];
  if (!att) return cancelAction();
  att.attacked = true;

  let kills = 0;
  Object.entries(ns.board).forEach(([id, unit]) => {
    const cell = boardCells[id];
    if (cell && zones.includes(cell.zone)) {
      delete ns.board[id]; kills++;
    }
  });
  addLog(`🚁 Вертолёт ударил по ${lineName} линии — уничтожено ${kills} юнитов!`);
  showToast(`🚁 Вертолёт уничтожил ${kills} юнитов!`, '#9b59b6');

  checkWin(ns);
  cancelAction();
  await pushGameState(ns);
}

// ── Win check ──
function checkWin(state) {
  if (state.players.length < 2) return;
  const alive = state.players.filter(p =>
    Object.values(state.board).some(u => u.owner === p.id)
  );
  if (alive.length === 1) {
    state.winner = alive[0].id;
    state.phase  = 'ended';
    addLog(`🏆 Победитель: ${alive[0].username}!`);
  }
}

// ── Deck confirm ──
async function confirmDeck() {
  if (State.deckSelection.length < 1) return;

  const { data: room } = await sb.from('game_rooms').select('*').eq('id', State.currentRoom.id).single();
  const players = room.players || [];
  const pi = players.findIndex(p => p.id === State.currentUser.id);
  if (pi >= 0) {
    players[pi].deck  = [...State.deckSelection];
    players[pi].ready = true;
  }

  const allReady = players.every(p => p.ready);
  if (allReady && room.host_id === State.currentUser.id) {
    const gs = createInitialGameState(players);
    await sb.from('game_rooms').update({
      players,
      status: 'playing',
      game_state: gs
    }).eq('id', State.currentRoom.id);
  } else {
    await sb.from('game_rooms').update({ players }).eq('id', State.currentRoom.id);
    showScreen('waitingScreen');
    document.getElementById('waitingInfo').textContent = 'Ожидание остальных игроков...';
  }
}

// ── Utilities ──
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}