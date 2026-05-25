// ===== MAIN ENTRY POINT =====

window._onSupabaseReady = async function () {
  console.log('[Main] App starting...');

  showScreen('authScreen');

  // Check existing session
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      State.currentUser = session.user;
      await loadUserProfile();
      await showLobby();
      return;
    }
  } catch (e) {
    console.warn('[Main] Session check failed:', e.message);
  }

  showScreen('authScreen');
};

// Ensure DB tables exist hint (run in Supabase SQL editor):
/*
  CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    username TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS game_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    host_id UUID,
    max_players INT DEFAULT 2,
    player_count INT DEFAULT 0,
    status TEXT DEFAULT 'waiting',
    game_state JSONB,
    players JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;
  ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "public read rooms"  ON game_rooms FOR SELECT USING (true);
  CREATE POLICY "public write rooms" ON game_rooms FOR ALL    USING (true);
  CREATE POLICY "public read profiles"  ON profiles FOR SELECT USING (true);
  CREATE POLICY "public write profiles" ON profiles FOR ALL    USING (true);
*/