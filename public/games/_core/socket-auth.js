/* NEXORNG socket sign-in — shared by the game clients (crash, solo, instant, slot, wheel, table).
 *
 * A game's socket connection signs in ONCE with the player's token; the socket server ties the
 * connection to that session and from then on the actions (bet, cash out, spin…) carry no token
 * — they carry a one-time number instead (1, 2, 3…), so a copied message cannot be sent again.
 * A session has one live connection: when the game is opened again (another tab, another
 * device) the older connection is closed with code 4001 and that page shows a notice instead of
 * reconnecting by itself (two pages would otherwise close each other for ever).
 *
 *   NXAuth.open(sock, TOKEN)                  in onopen, before the subscribe
 *   if (NXAuth.read(sock, m)) return;         in onmessage: the server's answer to the sign-in
 *   sock.send(NXAuth.pack(sock, op, EVENT, id, data))      an action
 *   if (NXAuth.replaced(sock, e, connect)) …  in onclose: closed because it is open elsewhere
 *
 * A socket server from before this (or one that cannot check tokens right now) answers the
 * sign-in with "unknown op" / ok:false: the page then sends its token with each action, as before.
 */
(function () {
  'use strict';

  var CLOSE_REPLACED = 4001;
  var state = new WeakMap(); // socket → { token, ok, n, replaced }

  function open(sock, token) {
    if (!token || token === 'demo') return; // demo: nothing is played on the server
    state.set(sock, { token: token, ok: false, n: 0 });
    sock.send(JSON.stringify({ op: 'auth', id: 'auth', data: { token: token } }));
  }

  function read(sock, m) {
    if (!m) return false;
    var st = state.get(sock);
    if (m.type === 'session.replaced') { // the last message before the close below
      if (st) st.replaced = true;
      return true;
    }
    if (m.type !== 'auth') return false;
    if (st) st.ok = !!(m.data && m.data.ok);
    return true;
  }

  function pack(sock, op, event, id, data) {
    var st = state.get(sock), msg = { op: op, event: event, id: id, data: data };
    if (st && st.ok) { // signed in: no token in the action, a one-time number instead
      var fields = {};
      for (var k in data) if (k !== 'token') fields[k] = data[k];
      msg.data = fields;
      msg.n = ++st.n;
    }
    return JSON.stringify(msg);
  }

  var notice = null;
  // (the server says it twice — the close code and a last message — so the page also knows
  // behind a proxy that rewrites close codes)
  // The encrypted channel refused this page for good (secure-socket.js closes with 4003 + the reason):
  // the session is locked to another browser, or it ended — reconnecting would not help.
  var REFUSED = {
    OTHER_DEVICE: ['Open on another device', 'This game session belongs to another browser or device. Open the game again from your casino.'],
    SESSION_EXPIRED: ['Session ended', 'Your game session has ended. Open the game again from your casino.'],
  };

  function replaced(sock, e, again) {
    var st = state.get(sock);
    var refused = e && e.code === 4003 && REFUSED[e.reason];
    if (!refused && !(e && e.code === CLOSE_REPLACED) && !(st && st.replaced)) return false;
    if (notice) return true;
    notice = document.createElement('div');
    notice.setAttribute('role', 'alertdialog');
    notice.setAttribute('aria-label', 'This game is open somewhere else');
    notice.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;' +
      'background:rgba(6,4,17,.78);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
      'font:500 15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f4f4f8;text-align:center';
    notice.innerHTML = '<div style="max-width:320px;padding:22px 20px;border-radius:18px;background:#15101f;' +
      'border:1px solid rgba(199,125,255,.35);box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
      '<div style="font-weight:800;font-size:18px;margin-bottom:8px">' + (refused ? refused[0] : 'Open somewhere else') + '</div>' +
      '<div style="color:#c9bfdc">' + (refused ? refused[1] : 'This game is now open in another tab or on another device with your account.') + '</div>' +
      '<button type="button" style="margin-top:16px;height:46px;padding:0 26px;border:0;border-radius:12px;cursor:pointer;' +
      'font:800 15px/1 inherit;color:#1a1203;background:linear-gradient(180deg,#ffcf6b,#ffbb60)">Play here</button></div>';
    if (refused) { notice.querySelector('button').remove(); document.body.appendChild(notice); return true; }
    notice.querySelector('button').onclick = function () {
      notice.remove();
      notice = null;
      again(); // a new connection: this page takes the session back
    };
    document.body.appendChild(notice);
    return true;
  }

  window.NXAuth = { open: open, read: read, pack: pack, replaced: replaced };
})();
