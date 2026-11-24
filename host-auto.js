'use strict';
// "Simple FileKeeper view".
// FileKeeper's page is full of ad buttons, and its main "Free download" button is a trap. The only thing the person
// needs is the "If the download doesn't start automatically, click here." line that appears after the page's own
// countdown. This script runs INSIDE the page and:
//   1. leaves the page alone while it counts down by itself,
//   2. waits until the "click here" line is really on screen (and stays there), then
//   3. covers the page with a plain dark screen and puts just that line in the middle. The person presses the link themselves (a real click).
// It never gives up for good after one bad moment: it keeps looking for up to 10 minutes. "Show the whole page" is always there as a way out.

function spotlightScript(hostKey, hint) {
  const message = JSON.stringify(String(hint || '').slice(0, 200));
  return `(() => {
  if (window.__zrSpot) return;
  window.__zrSpot = true;
  const HINT = ${message};
  const T0 = Date.now();
  const LOG = [];
  const note = (m) => { if (LOG.length < 80) LOG.push('+' + (Date.now() - T0) + 'ms ' + m); };
  const SENTENCE = /(doesn.?t|does not|didn.?t|did not) (start|begin)|start automatically/i;
  const text = (el) => (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ');
  const shown = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 24 && r.height > 10 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.2;
  };
  // The "click here" line: a short sentence about the download not starting, with a "click here." link inside it.
  const findLine = () => {
    const links = [...document.querySelectorAll('#download-link, a, button, [role=button]')].filter((el) => /^click here\\.?$/i.test(text(el)) && shown(el));
    for (const link of links) {
      for (let n = link.parentElement, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) {
        const t = text(n);
        if (SENTENCE.test(t) && t.length < 240) return n;
      }
    }
    return null;
  };

  let backdrop = null, msgEl = null, bigEl = null, target = null, saved = '', wrapped = [], off = false, timer = null, watch = null;
  let cand = null, stable = 0, badTries = 0;
  const style = document.createElement('style');
  style.textContent = '.zr-block, .zr-block * { color: #e8e8ee !important; background: transparent !important; text-align: center !important; font-size: 17px !important; line-height: 1.6 !important; }'
    + '.zr-block a, .zr-block a *, .zr-block button { color: #7aa7ff !important; font-weight: 700 !important; text-decoration: underline !important; cursor: pointer !important; }';

  const ensureBackdrop = (msg, big) => {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'zr-backdrop';
      backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0b0b0d;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font:14px system-ui,sans-serif;color:#c9c9cf';
      msgEl = document.createElement('p');
      msgEl.style.cssText = 'margin:56px 24px 0;max-width:520px;text-align:center;line-height:1.5';
      bigEl = document.createElement('div');
      bigEl.style.cssText = 'margin-top:70px;font:700 72px system-ui,sans-serif;color:#e8e8ee;min-height:84px';
      const full = document.createElement('button');
      full.textContent = 'Show the whole page';
      full.style.cssText = 'position:absolute;bottom:18px;background:none;border:0;color:#8a8a93;text-decoration:underline;cursor:pointer;font:13px system-ui,sans-serif';
      full.onclick = () => stop('person pressed Show the whole page');
      backdrop.append(msgEl, bigEl, full);
      document.documentElement.append(backdrop);
    }
    msgEl.textContent = msg;
    bigEl.textContent = big || '';
    bigEl.style.display = big ? 'block' : 'none';
  };
  const hideBackdrop = () => { if (backdrop) { backdrop.remove(); backdrop = null; } };
  const release = () => { // put the target and the boxes around it back as the page had them
    if (target) { target.setAttribute('style', saved); target.classList.remove('zr-block'); target = null; }
    for (const [n, st] of wrapped) { if (st) n.setAttribute('style', st); else n.removeAttribute('style'); }
    wrapped = [];
  };
  const stop = (why) => { // back to the normal page for good
    note('stop: ' + why);
    off = true;
    release();
    style.remove();
    if (backdrop) { backdrop.remove(); backdrop = null; }
    clearInterval(timer);
    if (watch) watch.disconnect();
  };

  const apply = (el) => {
    release();
    document.documentElement.append(style);
    el.classList.add('zr-block');
    target = el;
    saved = el.getAttribute('style') || '';
    const set = (k, v) => el.style.setProperty(k, v, 'important');
    for (const [k, v] of [['position', 'fixed'], ['top', '50%'], ['left', '50%'], ['transform', 'translate(-50%,-50%)'], ['z-index', '2147483647'], ['margin', '0'],
      ['visibility', 'visible'], ['opacity', '1'], ['display', 'block'], ['height', 'auto'], ['max-height', 'none'], ['overflow', 'visible'], ['clip-path', 'none'],
      ['filter', 'none'], ['right', 'auto'], ['bottom', 'auto'], ['pointer-events', 'auto'], ['width', 'min(480px, 88vw)'], ['padding', '0']]) set(k, v);
    // Boxes around it: a faded-out, transformed or clipped wrapper would keep it hidden or underneath the dark screen.
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      wrapped.push([n, n.getAttribute('style') || '']);
      const cs = getComputedStyle(n);
      const w = (k, v) => n.style.setProperty(k, v, 'important');
      for (const [k, v] of [['opacity', '1'], ['transform', 'none'], ['filter', 'none'], ['perspective', 'none'], ['contain', 'none'], ['will-change', 'auto'], ['mix-blend-mode', 'normal'],
        ['isolation', 'auto'], ['clip-path', 'none'], ['visibility', 'visible'], ['overflow', 'visible']]) w(k, v);
      if (cs.position !== 'static') w('z-index', 'auto');
      if (cs.display === 'none') w('display', 'block');
    }
    ensureBackdrop(HINT || 'Wait a moment. If nothing downloads, press the blue link below.');
    const r = el.getBoundingClientRect();
    const bad = r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || r.width < 40 || r.height < 12;
    if (bad) { note('line was not visible after styling (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')'); release(); hideBackdrop(); badTries++; return false; }
    note('showing the click-here line');
    return true;
  };

  const tick = () => {
    if (off) return;
    const ms = Date.now() - T0;
    if (target) {
      // keep it until the page removes it; if the page takes it away, go back to waiting
      if (!document.contains(target) || !shown(target.querySelector('a, button, [role=button]') || target)) { note('line went away'); release(); hideBackdrop(); cand = null; stable = 0; }
      else return;
    }
    // Only look once the page has finished loading its own styles, and only trust a line that stays put for a moment.
    const line = (document.readyState === 'complete' || ms > 3000) ? findLine() : null;
    if (line && line === cand) stable++; else { cand = line; stable = line ? 1 : 0; }
    if (line && stable >= 2) {
      if (apply(line)) return;
      if (badTries >= 4) return stop('line never became visible');
    }
  };

  // For the "Copy debug info" button. Every web address is cut down to its host name first.
  const scrub = (t) => String(t).replace(/https?:\\/\\/[^\\s"'<>)]+/g, (m) => { try { return '[' + new URL(m).hostname + ']'; } catch (e) { return '[link]'; } })
    .replace(/[A-Za-z0-9_-]{24,}/g, '[token]');
  window.__zrDebug = () => {
    const out = [];
    out.push('page host: ' + location.hostname + ' | ready: ' + document.readyState + ' | spotlight: ' + (target ? 'click-here line' : 'none') + (off ? ' (off)' : '') + ' | uptime ' + (Date.now() - T0) + 'ms');
    out.push('script log:'); for (const l of LOG) out.push('  ' + l);
    const near = [...document.querySelectorAll('a, button, [role=button]')].filter((el) => /download|click here/i.test(text(el))).slice(0, 10);
    out.push('candidates (' + near.length + '):');
    for (const el of near) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      let chain = '';
      for (let n = el.parentElement, i = 0; n && i < 3; n = n.parentElement, i++) chain += ' < ' + n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (target ? '' : (getComputedStyle(n).display === 'none' ? '(display:none)' : '') + (getComputedStyle(n).opacity !== '1' ? '(op:' + getComputedStyle(n).opacity + ')' : ''));
      out.push('  <' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '> "' + text(el).slice(0, 40) + '" ' + (el.getAttribute('href') ? 'href=' + scrub(el.getAttribute('href')).slice(0, 60) + ' ' : '') + Math.round(r.width) + 'x' + Math.round(r.height) + ' display:' + cs.display + ' vis:' + cs.visibility + ' op:' + cs.opacity + chain);
    }
    // How the page builds its download address: the page's own small scripts that mention it, with tokens removed.
    let code = '';
    for (const s of document.scripts) {
      if (s.src || !s.textContent) continue;
      if (/download|countdown|iframe|server|host/i.test(s.textContent)) code += '\\n---\\n' + scrub(s.textContent.replace(/\\s+/g, ' ')).slice(0, 2200);
      if (code.length > 6000) break;
    }
    out.push('page scripts about downloading:' + (code || ' (none inline)'));
    return out.join('\\n');
  };

  note('started, document ' + document.readyState);
  tick();
  timer = setInterval(tick, 400);
  watch = new MutationObserver(() => { if (!off && !backdrop) tick(); });
  watch.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => { if (!off) stop('10 minute limit'); }, 10 * 60 * 1000);
})();`;
}

module.exports = { spotlightScript };
