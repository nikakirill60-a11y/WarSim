// ===== UI HELPERS =====

function showScreen(id) {
  ['authScreen','lobbyScreen','waitingScreen','gameScreen','deckScreen']
    .forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = (s === id) ? 'flex' : 'none';
    });
}

function showToast(msg, color = '#ff6b35') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.background = color;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

function showModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  State.actionMode  = null;
  State.selectedUnit= null;
  drawBoard();
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function setBoardHint(msg) {
  const el = document.getElementById('boardHint');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

// ===== AUTH UI =====
function switchTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display    = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('authMsg').textContent = '';
}

function showAuthMsg(msg) {
  document.getElementById('authMsg').textContent = msg;
}

// ===== LOBBY UI =====
function selectCount(n) {
  State.selectedPlayerCount = n;
  [2, 3, 4, 6].forEach(c => {
    const el = document.getElementById(`cnt${c}`);
    if (el) el.classList.toggle('active', c === n);
  });
}

// ===== GAME UI =====
function renderPlayersPanel() {
  const gs = State.gameState;
  if (!gs) return;
  document.getElementById('playersList').innerHTML = gs.players.map((p, i) => `
    <div class="player-card ${i === gs.turn ? 'active' : ''}">
      <div class="player-dot" style="background:${PLAYER_COLORS[p.colorIdx]}"></div>
      <div class="player-name">${p.username}${p.id === State.myPlayerId ? ' (Вы)' : ''}</div>
      <div class="player-juice">🧃${p.juice || 0}</div>
    </div>
  `).join('');
}

function renderShop() {
  const cards = Object.values(CARDS).filter(c => c.id !== 'elitepawn');
  document.getElementById('shopGrid').innerHTML = cards.map(card => `
    <div class="card-item ${State.selectedCard === card.id ? 'selected' : ''}"
         onclick="selectShopCard('${card.id}')"
         title="${card.desc}">
      <div class="ci-icon">${card.icon}</div>
      <div class="ci-name">${card.name}</div>
      <div class="ci-cost">💧${card.cost}</div>
      <div class="ci-stats">❤️${card.hp} ⚔️${card.damage}</div>
    </div>
  `).join('');
  updateBoughtUnits();
}

function updateBoughtUnits() {
  const bought = State.gameState?.boughtThisTurn || [];
  const el = document.getElementById('boughtUnits');
  if (!el) return;
  el.innerHTML = bought.length
    ? bought.map(id => {
        const c = CARDS[id];
        return `<div class="unit-badge">${c.icon} ${c.name}</div>`;
      }).join('')
    : '<span style="color:#555;font-size:11px">—</span>';
}

function updateTurnUI() {
  const gs = State.gameState;
  if (!gs) return;

  const cur  = gs.players[gs.turn];
  const mine = gs.players.find(p => p.id === State.myPlayerId);
  const isMe = isMyTurn();

  const phases = {
    spin:        '🎲 Крутите рулетку',
    buy:         '🛒 Покупайте карты',
    spawn:       '📍 Расставьте юнитов',
    move:        '⚔️  Двигайте юнитов',
    base_select: '🏠 Выберите базу',
    ended:       '🏆 Игра окончена',
  };
  const phaseName = phases[gs.phase] || gs.phase;

  document.getElementById('currentTurnName').textContent = cur?.username || '-';
  document.getElementById('currentTurnName').style.color = PLAYER_COLORS[cur?.colorIdx || 0];
  document.getElementById('currentPhase').textContent    = phaseName;
  document.getElementById('myJuice').textContent         = mine?.juice || 0;
  document.getElementById('headerTurnName').textContent  = `${cur?.username || '-'}`;
  document.getElementById('headerPhase').textContent     = phaseName;

  document.getElementById('spinBtn').disabled    = !isMe || gs.phase !== 'spin';
  document.getElementById('buyBtn').disabled     = !canBuySelected();
  document.getElementById('endTurnBtn').disabled = !isMe || !['buy','move','spawn'].includes(gs.phase);

  renderPlayersPanel();
  updateBoughtUnits();
}

function updateBuyBtn() {
  document.getElementById('buyBtn').disabled = !canBuySelected();
}

function canBuySelected() {
  const gs = State.gameState;
  if (!gs || !isMyTurn() || gs.phase !== 'buy') return false;
  const card = State.selectedCard ? CARDS[State.selectedCard] : null;
  if (!card) return false;
  const me = gs.players.find(p => p.id === State.myPlayerId);
  return (me?.juice || 0) >= card.cost && (gs.boughtThisTurn?.length || 0) < 6;
}

function addLog(msg) {
  const el = document.getElementById('gameLog');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'log-msg';
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  if (State.gameState) {
    State.gameState.log = [...(State.gameState.log || []).slice(-60), msg];
  }
}

function renderLog() {
  const el = document.getElementById('gameLog');
  if (!el || !State.gameState?.log) return;
  el.innerHTML = State.gameState.log.slice(-30).map(m =>
    `<div class="log-msg">${m}</div>`
  ).join('');
  el.scrollTop = el.scrollHeight;
}

// ===== DECK SELECTION UI =====
function renderDeckCards() {
  const cards = Object.values(CARDS).filter(c => c.id !== 'elitepawn');
  document.getElementById('deckCardsList').innerHTML = cards.map(card => `
    <div class="deck-card" onclick="toggleDeckCard('${card.id}')">
      <div class="card-icon">${card.icon}</div>
      <div class="card-name">${card.name}</div>
      <div class="card-cost">💧${card.cost} сока</div>
      <div class="card-stats">❤️${card.hp} ⚔️${card.damage}</div>
      <div class="card-desc">${card.desc}</div>
    </div>
  `).join('');
  updateDeckUI();
}

function toggleDeckCard(cardId) {
  if (State.deckSelection.length >= 6) {
    showToast('Максимум 6 карт!'); return;
  }
  State.deckSelection.push(cardId);
  updateDeckUI();
}

function removeDeckCard(idx) {
  State.deckSelection.splice(idx, 1);
  updateDeckUI();
}

function updateDeckUI() {
  document.getElementById('deckCount').textContent = State.deckSelection.length;
  document.getElementById('deckSelected').innerHTML = State.deckSelection.map((id, i) => {
    const c = CARDS[id];
    return `<div class="deck-badge">${c.icon} ${c.name}
      <span class="remove-btn" onclick="removeDeckCard(${i})">✕</span></div>`;
  }).join('');
  document.getElementById('confirmDeckBtn').disabled = State.deckSelection.length < 1;
}

// ===== WIN MODAL =====
function showWinModal(player) {
  showModal(`
    <div style="font-size:52px;margin-bottom:12px">🏆</div>
    <h2>Победа!</h2>
    <p style="font-size:20px;color:${PLAYER_COLORS[player.colorIdx]};font-weight:bold;margin:10px 0">
      ${player.username}
    </p>
    <p>выиграл партию!</p>
    <button class="btn" style="margin-top:20px" onclick="leaveRoom()">В лобби</button>
  `);
}