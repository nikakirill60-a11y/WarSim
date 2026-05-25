// ===== SUPABASE CONFIG =====
const SUPABASE_URL = "https://cayhxupqrevawfxgcvqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_bxQes_1IX6cMh9HWlfZdMA__5kVY8r4";

// Init Supabase via CDN (loaded inline to avoid tracking prevention)
(function loadSupabase() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, storageKey: 'star-battle-auth' }
    });
    console.log('[Config] Supabase ready');
    if (window._onSupabaseReady) window._onSupabaseReady();
  };
  script.onerror = () => {
    console.warn('[Config] CDN blocked, using fallback fetch');
    window.sb = createFallbackClient(SUPABASE_URL, SUPABASE_KEY);
    if (window._onSupabaseReady) window._onSupabaseReady();
  };
  document.head.appendChild(script);
})();

// ===== FALLBACK CLIENT (if CDN blocked) =====
function createFallbackClient(url, key) {
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const stored = { session: null };

  try {
    const s = localStorage.getItem('star-battle-auth');
    if (s) stored.session = JSON.parse(s);
  } catch(e) {}

  function saveSession(s) {
    stored.session = s;
    try { localStorage.setItem('star-battle-auth', JSON.stringify(s)); } catch(e) {}
  }

  function authHeaders() {
    const token = stored.session?.access_token || key;
    return { ...headers, 'Authorization': `Bearer ${token}` };
  }

  const auth = {
    async signUp({ email, password, options }) {
      const r = await fetch(`${url}/auth/v1/signup`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, password, data: options?.data || {} })
      });
      const data = await r.json();
      if (data.error || data.msg) return { data: null, error: { message: data.error_description || data.msg || 'Ошибка' } };
      if (data.access_token) saveSession(data);
      return { data: { user: data.user || data }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (data.error || data.error_description) return { data: null, error: { message: data.error_description || data.error } };
      saveSession(data);
      return { data: { user: data.user, session: data }, error: null };
    },
    async signOut() {
      saveSession(null);
      return { error: null };
    },
    async getSession() {
      return { data: { session: stored.session } };
    },
    onAuthStateChange(cb) { return { data: { subscription: { unsubscribe() {} } } }; }
  };

  function buildQuery(table) {
    let _url = `${url}/rest/v1/${table}`;
    let _method = 'GET';
    let _body = null;
    let _filters = [];
    let _select = '*';
    let _single = false;
    let _upsert = false;

    const q = {
      select(cols) { _select = cols; _url = `${url}/rest/v1/${table}?select=${cols}`; return q; },
      eq(col, val) { _filters.push(`${col}=eq.${val}`); return q; },
      order(col, { ascending } = {}) { _filters.push(`order=${col}.${ascending?'asc':'desc'}`); return q; },
      limit(n) { _filters.push(`limit=${n}`); return q; },
      single() { _single = true; return q; },
      upsert(data) {
        _upsert = true; _method = 'POST'; _body = JSON.stringify(data);
        return q;
      },
      insert(data) { _method = 'POST'; _body = JSON.stringify(Array.isArray(data)?data:[data]); return q; },
      update(data) { _method = 'PATCH'; _body = JSON.stringify(data); return q; },
      delete() { _method = 'DELETE'; return q; },
      async then(resolve) {
        try {
          let finalUrl = _url;
          if (!finalUrl.includes('?')) finalUrl += '?select=' + _select;
          if (_filters.length) finalUrl += '&' + _filters.join('&');
          const h = { ...authHeaders() };
          if (_upsert) h['Prefer'] = 'resolution=merge-duplicates,return=representation';
          else if (_method !== 'GET') h['Prefer'] = 'return=representation';
          if (_single) h['Accept'] = 'application/vnd.pgrst.object+json';
          const r = await fetch(finalUrl, { method: _method, headers: h, body: _body });
          let data = null;
          if (r.status !== 204) {
            try { data = await r.json(); } catch(e) { data = null; }
          }
          if (!r.ok) {
            resolve({ data: null, error: { message: data?.message || data?.hint || `HTTP ${r.status}` } });
          } else {
            resolve({ data: _single ? (Array.isArray(data) ? data[0] : data) : data, error: null });
          }
        } catch(e) {
          resolve({ data: null, error: { message: e.message } });
        }
      },
      catch(fn) { return q; }
    };
    return q;
  }

  const channels = {};
  let pollInterval = null;
  const listeners = [];

  function pollRooms() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      for (const fn of listeners) {
        try { await fn(); } catch(e) {}
      }
    }, 2000);
  }

  return {
    auth,
    from(table) { return buildQuery(table); },
    channel(name) {
      return {
        on(event, filter, cb) {
          if (filter.table === 'game_rooms' && filter.filter) {
            const roomId = filter.filter.split('eq.')[1];
            listeners.push(async () => {
              const r = await fetch(`${url}/rest/v1/game_rooms?id=eq.${roomId}&select=*`, {
                headers: { ...authHeaders(), 'Accept': 'application/vnd.pgrst.object+json' }
              });
              if (r.ok) {
                const data = await r.json();
                if (data) cb({ new: data });
              }
            });
            pollRooms();
          }
          return this;
        },
        subscribe() { return this; }
      };
    },
    removeChannel(ch) {}
  };
}

// ===== CARDS =====
const CARDS = {
  pawn:      { id:'pawn',      name:'Пешка',          icon:'♟️',  cost:1, hp:1, damage:1, range:1, special:null,        desc:'Базовый юнит' },
  bigpawn:   { id:'bigpawn',   name:'Большая пешка',   icon:'🛡️',  cost:2, hp:2, damage:2, range:1, special:null,        desc:'Усиленная пешка' },
  tank:      { id:'tank',      name:'Танк',             icon:'🚗',  cost:6, hp:5, damage:3, range:1, special:null,        desc:'Живучий боец' },
  helicopter:{ id:'helicopter',name:'Вертолёт',         icon:'🚁',  cost:6, hp:1, damage:99,range:99,special:'line_kill', desc:'Убивает всю линию (вкл. своих)!' },
  rpg:       { id:'rpg',       name:'РПГ',              icon:'💥',  cost:4, hp:2, damage:5, range:1, special:null,        desc:'Высокий урон' },
  rocket:    { id:'rocket',    name:'Ракета',           icon:'🎯',  cost:4, hp:2, damage:2, range:99,special:'aoe',       desc:'Бьёт по любой клетке, радиус 1' },
  elitepawn: { id:'elitepawn', name:'Элитная пешка',   icon:'👑',  cost:0, hp:4, damage:3, range:1, special:null,        desc:'Бонус за двойную 6!' },
};

// ===== PLAYER COLORS =====
const PLAYER_COLORS  = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#1abc9c'];
const PLAYER_COLORS_DARK = ['#922b21','#1a5276','#1e8449','#b7950b','#6c3483','#0e6655'];
const ZONE_COLORS    = {
  center: '#c8d6e5',
  p0: '#e74c3c',
  p1: '#2ecc71',
  p2: '#f1c40f',
  p3: '#c0392b',
  p4: '#27ae60',
  p5: '#9b59b6',
};

// ===== GLOBAL STATE =====
const State = {
  currentUser:  null,
  currentRoom:  null,
  gameState:    null,
  myPlayerId:   null,
  selectedCard: null,
  selectedUnit: null,
  actionMode:   null,   // 'move' | 'attack' | 'rocket_target' | 'heli_line'
  deckSelection:[],
  rotationDeg:  0,
  spinning:     false,
  channel:      null,
  roomsInterval:null,
};