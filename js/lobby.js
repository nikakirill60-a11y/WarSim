// ===== LOBBY =====

State.selectedPlayerCount = 2;

async function showLobby() {
  showScreen('lobbyScreen');
  document.getElementById('lobbyUserName').textContent =
    `👤 ${State.currentUser?.username || 'Игрок'}`;
  await refreshRooms();
  clearInterval(State.roomsInterval);
  State.roomsInterval = setInterval(refreshRooms, 3500);
}

async function refreshRooms() {
  const { data } = await sb.from('game_rooms')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  const el = document.getElementById('roomsItems');
  if (!data || !data.length) {
    el.innerHTML = '<p class="muted">Нет открытых комнат</p>';
    return;
  }
  el.innerHTML = data.map(room => `
    <div class="room-item">
      <div>
        <div class="room-item-name">${room.name || 'Комната'}</div>
        <div class="room-item-info">
          ${room.player_count || 0}/${room.max_players || 2} игроков
        </div>
      </div>
      <button class="btn room-join-btn" onclick="joinRoom('${room.id}')">Войти</button>
    </div>
  `).join('');
}

async function createRoom() {
  if (!State.currentUser) return;
  clearInterval(State.roomsInterval);

  const { data, error } = await sb.from('game_rooms').insert({
    name: `Игра ${State.currentUser.username}`,
    host_id: State.currentUser.id,
    max_players: State.selectedPlayerCount,
    player_count: 1,
    status: 'waiting',
    game_state: null,
    players: [{
      id: State.currentUser.id,
      username: State.currentUser.username,
      colorIdx: 0,
      ready: false,
      deck: []
    }],
  }).select().single();

  if (error) { showToast('Ошибка создания комнаты: ' + error.message); return; }
  State.currentRoom = data;
  State.myPlayerId  = State.currentUser.id;
  enterWaiting();
}

async function joinRoom(roomId) {
  clearInterval(State.roomsInterval);

  const { data: room } = await sb.from('game_rooms').select('*').eq('id', roomId).single();
  if (!room) { showToast('Комната не найдена'); return; }
  if ((room.player_count || 0) >= room.max_players) { showToast('Комната заполнена!'); return; }

  const players  = room.players || [];
  const colorIdx = players.length;
  players.push({
    id: State.currentUser.id,
    username: State.currentUser.username,
    colorIdx,
    ready: false,
    deck: []
  });

  const { data, error } = await sb.from('game_rooms')
    .update({ players, player_count: players.length })
    .eq('id', roomId)
    .select().single();

  if (error) { showToast('Ошибка входа: ' + error.message); return; }
  State.currentRoom = data;
  State.myPlayerId  = State.currentUser.id;
  enterWaiting();
}

function enterWaiting() {
  showScreen('waitingScreen');
  document.getElementById('waitingInfo').textContent = 'Подключаемся...';
  subscribeToRoom();
}

async function leaveRoom() {
  clearInterval(State.roomsInterval);
  if (State.channel) { try { sb.removeChannel(State.channel); } catch(e) {} State.channel = null; }

  if (State.currentRoom) {
    const { data: room } = await sb.from('game_rooms').select('*').eq('id', State.currentRoom.id).single();
    if (room) {
      const players = (room.players || []).filter(p => p.id !== State.currentUser.id);
      if (players.length === 0) {
        await sb.from('game_rooms').delete().eq('id', State.currentRoom.id);
      } else {
        await sb.from('game_rooms').update({
          players,
          player_count: players.length,
          host_id: players[0].id
        }).eq('id', State.currentRoom.id);
      }
    }
  }

  State.currentRoom  = null;
  State.gameState    = null;
  State.myPlayerId   = null;
  State.selectedUnit = null;
  State.actionMode   = null;
  State.selectedCard = null;

  await showLobby();
}

// ── Real-time subscription ──
function subscribeToRoom() {
  if (State.channel) { try { sb.removeChannel(State.channel); } catch(e) {} }

  State.channel = sb
    .channel(`room_${State.currentRoom.id}_${Date.now()}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'game_rooms',
      filter: `id=eq.${State.currentRoom.id}`
    }, handleRoomUpdate)
    .subscribe();

  // Initial fetch
  setTimeout(checkRoomOnce, 800);
}

async function checkRoomOnce() {
  const { data } = await sb.from('game_rooms').select('*').eq('id', State.currentRoom.id).single();
  if (data) handleRoomUpdate({ new: data });
}

function handleRoomUpdate(payload) {
  const room = payload.new;
  if (!room) return;
  State.currentRoom = room;

  const players = room.players || [];
  const info    = document.getElementById('waitingInfo');
  if (info) {
    info.textContent =
      `${players.length}/${room.max_players} • ${players.map(p => p.username).join(', ')}`;
  }

  // Auto-start deck selection when room is full
  if (room.status === 'waiting' &&
      players.length >= room.max_players &&
      room.host_id === State.currentUser.id) {
    sb.from('game_rooms').update({ status: 'deck_selection' }).eq('id', room.id);
    return;
  }

  if (room.status === 'deck_selection') {
    State.deckSelection = [];
    showScreen('deckScreen');
    renderDeckCards();
    return;
  }

  if (room.status === 'playing' && room.game_state) {
    State.gameState = room.game_state;
    startGameScreen();
    return;
  }

  if (room.status === 'ended' && room.game_state?.winner) {
    const winner = room.game_state.players?.find(p => p.id === room.game_state.winner);
    if (winner) showWinModal(winner);
  }
}

// ── Start game ──
function startGameScreen() {
  showScreen('gameScreen');
  buildBoard();
  initCanvas();
  syncBoardFromState();
  renderPlayersPanel();
  renderShop();
  updateTurnUI();
  renderLog();
  drawBoard();

  setBoardHint(
    State.gameState.phase === 'base_select'
      ? 'Кликните на клетку своей цветной зоны — это ваша база'
      : ''
  );

  // Subscribe to game updates
  if (State.channel) { try { sb.removeChannel(State.channel); } catch(e) {} }
  State.channel = sb
    .channel(`game_${State.currentRoom.id}_${Date.now()}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'game_rooms',
      filter: `id=eq.${State.currentRoom.id}`
    }, payload => {
      if (!payload.new?.game_state) return;
      State.gameState = payload.new.game_state;
      syncBoardFromState();
      renderPlayersPanel();
      renderShop();
      updateTurnUI();
      renderLog();
      drawBoard();
      setBoardHint(
        State.gameState.phase === 'base_select' ? 'Кликните на клетку своей цветной зоны' :
        State.gameState.phase === 'spawn'        ? 'Кликните на свою зону для размещения юнита' :
        ''
      );
      if (State.gameState.winner) {
        const w = State.gameState.players?.find(p => p.id === State.gameState.winner);
        if (w) showWinModal(w);
      }
    })
    .subscribe();
}