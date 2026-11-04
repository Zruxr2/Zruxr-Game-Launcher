(() => {
  const $ = (id) => document.getElementById(id);
  const card = $('card'), logo = $('logo'), arc = $('arc'), fx = $('fx'), ctx = fx.getContext('2d');
  const views = { welcome: $('v-welcome'), install: $('v-install'), done: $('v-done'), error: $('v-error') };
  const CIRC = 2 * Math.PI * 58;
  arc.style.strokeDasharray = CIRC;

  const STEPS = [
    [0, 'Warming up the engines'], [0.08, 'Unpacking core files'], [0.3, 'Setting up the runtime'],
    [0.55, 'Installing libraries'], [0.8, 'Creating shortcuts'], [0.93, 'Final touches'],
  ];

  let state = 'welcome', target = 0, disp = 0, burst = 0, dir = '', stepIdx = -1;

  // ---- title letters ------------------------------------------------------
  [...'Zruxr'].forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = c; s.style.animationDelay = (0.6 + i * 0.08) + 's';
    $('title').appendChild(s);
  });

  // ---- views --------------------------------------------------------------
  function show(name) {
    state = name;
    card.dataset.state = name;
    for (const k in views) views[k].classList.toggle('on', k === name);
    $('close').disabled = name === 'install';
  }

  function finish() {
    show('done');
    burst = 3.4;
    logo.classList.add('done');
    $('pct').textContent = '100';
  }

  function fail(msg) {
    $('errMsg').textContent = msg || 'Unknown error.';
    show('error');
  }

  function setStatus(i) {
    if (i === stepIdx) return;
    stepIdx = i;
    const el = $('status');
    el.classList.add('swap');
    setTimeout(() => { el.textContent = STEPS[i][1]; el.classList.remove('swap'); }, 200);
  }

  // ---- wiring -------------------------------------------------------------
  window.setup.info().then((i) => {
    dir = i.dir;
    $('path').textContent = dir; $('path').title = dir;
    $('ver').textContent = 'Version ' + i.version + (i.demo ? '  (demo mode)' : '');
  });

  $('browse').onclick = async () => { dir = await window.setup.browse(); $('path').textContent = dir; $('path').title = dir; };
  $('min').onclick = () => window.setup.minimize();
  $('close').onclick = () => window.setup.close();
  $('quit').onclick = () => window.setup.close();
  $('finish').onclick = () => window.setup.close();

  $('install').onclick = async () => {
    target = 0; disp = 0; stepIdx = -1;
    $('dirNote').textContent = dir;
    $('status').textContent = STEPS[0][1];
    show('install');
    const r = await window.setup.install(dir);
    if (r && r.error) fail(r.error);
  };

  $('retry').onclick = () => { logo.classList.remove('done'); target = disp = 0; show('welcome'); };

  $('launch').onclick = () => {
    card.classList.add('out');
    window.setup.launch();
  };

  window.setup.onProgress((p) => { target = Math.max(target, p); });
  window.setup.onDone(() => { target = 1; });
  window.setup.onError((m) => fail(m));

  // ---- mouse parallax -----------------------------------------------------
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  window.addEventListener('mousemove', (e) => {
    tmx = (e.clientX / innerWidth - 0.5) * 2;
    tmy = (e.clientY / innerHeight - 0.5) * 2;
  });

  // ---- warp starfield -----------------------------------------------------
  const N = 170;
  const mk = (z) => ({ x: (Math.random() - 0.5) * 2.2, y: (Math.random() - 0.5) * 2.2, z: z ?? Math.random(), dim: Math.random() < 0.3 });
  const stars = Array.from({ length: N }, () => mk());
  let W = 0, H = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = fx.clientWidth; H = fx.clientHeight;
    fx.width = W * dpr; fx.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now(), cur = 0.05;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    mx += (tmx - mx) * Math.min(1, dt * 3);
    my += (tmy - my) * Math.min(1, dt * 3);
    card.style.setProperty('--mx', mx.toFixed(3));
    card.style.setProperty('--my', my.toFixed(3));

    // progress easing + UI
    if (state === 'install') {
      disp += (target - disp) * Math.min(1, dt * 3.5);
      if (target >= 1 && disp > 0.996) disp = 1;
      const pct = Math.floor(disp * 100);
      $('pct').textContent = pct;
      let idx = 0;
      STEPS.forEach((s, i) => { if (disp >= s[0]) idx = i; });
      setStatus(idx);
      if (disp >= 1) finish();
    }
    if (state === 'install' || state === 'done') {
      const p = state === 'done' ? 1 : disp;
      arc.style.strokeDashoffset = CIRC * (1 - p);
      arc.style.opacity = p < 0.004 ? 0 : 1;
      $('bar').style.transform = 'scaleX(' + p + ')';
    } else {
      arc.style.opacity = 0;
      $('bar').style.transform = 'scaleX(0)';
    }

    // star speed
    let speed = 0.05;
    if (state === 'install') speed = 0.12 + 0.3 * disp + 0.9 * disp * disp;
    speed += burst;
    burst *= Math.exp(-dt * 2.2);
    cur += (speed - cur) * Math.min(1, dt * 3);

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2 + mx * -14, cy = 122 + my * -10, S = W * 0.55;
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z -= cur * dt;
      const pz = s.z + Math.max(0.0015, cur * 0.05);
      let sx = cx + (s.x / s.z) * S, sy = cy + (s.y / s.z) * S;
      if (s.z <= 0.02 || sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) { Object.assign(s, mk(1)); continue; }
      const px = cx + (s.x / pz) * S, py = cy + (s.y / pz) * S;
      const a = Math.pow(1 - s.z, 1.3) * (s.dim ? 0.45 : 0.9);
      ctx.strokeStyle = 'rgba(' + (s.dim ? '160,160,160' : '240,240,240') + ',' + a.toFixed(3) + ')';
      ctx.lineWidth = 0.5 + (1 - s.z) * 1.8;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
