// ===== AUTH =====

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if (!email || !pass) return showAuthMsg('Заполните все поля');

  showAuthMsg('Входим...');
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return showAuthMsg(error.message);

  State.currentUser = data.user;
  await loadUserProfile();
  showLobby();
}

async function register() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPass').value;

  if (!name || !email || !pass) return showAuthMsg('Заполните все поля');
  if (pass.length < 6) return showAuthMsg('Пароль минимум 6 символов');

  showAuthMsg('Регистрируемся...');
  const { data, error } = await sb.auth.signUp({
    email, password: pass,
    options: { data: { username: name } }
  });
  if (error) return showAuthMsg(error.message);

  State.currentUser = data.user;
  if (State.currentUser) {
    await sb.from('profiles').upsert({
      id: State.currentUser.id,
      username: name,
    });
  }
  showAuthMsg('✅ Готово! Теперь войдите в аккаунт.');
  switchTab('login');
}

async function logout() {
  await sb.auth.signOut();
  State.currentUser = null;
  clearInterval(State.roomsInterval);
  showScreen('authScreen');
}

async function loadUserProfile() {
  if (!State.currentUser) return;
  const { data } = await sb.from('profiles').select('*').eq('id', State.currentUser.id).single();
  if (data?.username) State.currentUser.username = data.username;
  else State.currentUser.username =
    State.currentUser.user_metadata?.username || State.currentUser.email?.split('@')[0] || 'Игрок';
}