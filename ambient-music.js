/* =========================================================
   ambient-music.js — مشغّل بيانو هادئ مدمج بالكامل داخل الموقع
   يضم مقطوعة إنترستيلار الهادئة + إمكانية إغلاق القائمة مع استمرار العزف
   ========================================================= */
(function () {
  'use strict';

  const PIECES = [
    {
      name: 'بيانو إنترستيلار (كاملة)',
      tempoMs: 340,
      // مقطوعة كاملة متعددة المراحل: تمهيد هادئ -> صعود -> ذروة بالأوكتاف -> ختام هادئ
      notes: [
        // 1) تمهيد هادئ
        440.00, 329.63, 440.00, 329.63, 440.00, 329.63, 440.00, 329.63,
        493.88, 329.63, 493.88, 329.63, 493.88, 329.63, 493.88, 329.63,
        523.25, 329.63, 523.25, 329.63, 523.25, 329.63, 523.25, 329.63,
        587.33, 329.63, 587.33, 329.63, 493.88, 329.63, 440.00, 329.63,
        // 2) مرحلة الصعود (لحن أعلى)
        440.00, 329.63, 523.25, 329.63, 659.25, 329.63, 587.33, 329.63,
        493.88, 329.63, 587.33, 329.63, 659.25, 329.63, 523.25, 329.63,
        523.25, 392.00, 659.25, 392.00, 783.99, 392.00, 659.25, 392.00,
        587.33, 392.00, 659.25, 392.00, 587.33, 329.63, 493.88, 329.63,
        // 3) الذروة العاطفية (أربيجيو ممتد مع هارموني)
        659.25, 440.00, 880.00, 440.00, 783.99, 440.00, 659.25, 440.00,
        587.33, 392.00, 783.99, 392.00, 659.25, 392.00, 587.33, 392.00,
        523.25, 349.23, 698.46, 349.23, 659.25, 349.23, 523.25, 349.23,
        587.33, 392.00, 659.25, 392.00, 587.33, 329.63, 493.88, 329.63,
        // 4) ختام هادئ يعود للبداية بسلاسة
        440.00, 329.63, 523.25, 329.63, 493.88, 329.63, 440.00, 329.63,
        392.00, 293.66, 440.00, 293.66, 392.00, 293.66, 329.63, 246.94,
        349.23, 261.63, 440.00, 261.63, 392.00, 246.94, 329.63, 220.00,
        293.66, 220.00, 329.63, 220.00, 392.00, 246.94, 440.00, 329.63
      ],
      bassEvery: 8,
      bassNotes: [
        174.61, 196.00, 220.00, 196.00,
        174.61, 196.00, 130.81, 196.00,
        220.00, 196.00, 174.61, 196.00,
        174.61, 146.83, 130.81, 110.00
      ]
    },
    {
      name: 'بيانو هادئ 1',
      tempoMs: 650,
      notes: [
        220.00, 329.63, 440.00, 523.25, 493.88, 440.00, 329.63, 261.63,
        174.61, 261.63, 349.23, 440.00, 392.00, 349.23, 261.63, 220.00,
        130.81, 261.63, 329.63, 392.00, 523.25, 493.88, 392.00, 329.63,
        196.00, 293.66, 392.00, 493.88, 440.00, 392.00, 293.66, 246.94
      ],
      bassEvery: 8,
      bassNotes: [110.00, 87.31, 130.81, 98.00]
    },
    {
      name: 'بيانو هادئ 2',
      tempoMs: 740,
      notes: [
        261.63, 392.00, 493.88, 587.33, 523.25, 493.88, 392.00, 329.63,
        220.00, 329.63, 440.00, 523.25, 493.88, 440.00, 329.63, 246.94,
        174.61, 261.63, 349.23, 440.00, 523.25, 440.00, 349.23, 261.63,
        196.00, 293.66, 392.00, 440.00, 493.88, 440.00, 392.00, 293.66
      ],
      bassEvery: 8,
      bassNotes: [130.81, 110.00, 87.31, 98.00]
    }
  ];

  let ctx = null;
  let masterGain = null;
  let isPlaying = false;
  let isPanelOpen = false;
  let timer = null;
  let step = 0;
  let pieceIdx = 0;
  let volume = 0.55;

  function playPianoNote(freq, isBass) {
    if (!ctx || !masterGain || !isPlaying) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(isBass ? 0.12 : 0.18, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isBass ? 750 : 1750, now);
    filter.frequency.exponentialRampToValueAtTime(450, now + 2.2);

    const peak = isBass ? 0.14 : 0.09;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, now + (isBass ? 3.2 : 2.1));

    osc1.connect(filter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 3.4);
    osc2.stop(now + 3.4);
  }

  function tick() {
    if (!isPlaying) return;
    const piece = PIECES[pieceIdx % PIECES.length];
    const note = piece.notes[step % piece.notes.length];
    playPianoNote(note, false);
    if (piece.bassNotes && (step % piece.bassEvery) === 0) {
      const bassIdx = Math.floor(step / piece.bassEvery) % piece.bassNotes.length;
      playPianoNote(piece.bassNotes[bassIdx], true);
    }
    step++;
  }

  function startPiano() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctx) {
      ctx = new AudioCtx();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    isPlaying = true;
    isPanelOpen = true;
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, PIECES[pieceIdx % PIECES.length].tempoMs);
    renderUi();
  }

  function stopPiano() {
    isPlaying = false;
    isPanelOpen = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    renderUi();
  }

  window.pgToggleAmbientMusic = function () {
    if (!isPlaying) {
      startPiano();
    } else if (!isPanelOpen) {
      isPanelOpen = true;
      renderUi();
    } else {
      stopPiano();
    }
  };

  window.pgHidePianoPanel = function () {
    isPanelOpen = false;
    renderUi();
  };

  window.pgStopAmbientMusic = function () {
    stopPiano();
  };

  window.pgNextPianoTrack = function () {
    pieceIdx = (pieceIdx + 1) % PIECES.length;
    step = 0;
    if (isPlaying) startPiano();
    else renderUi();
  };

  window.pgSetPianoVolume = function (val) {
    volume = Math.min(1, Math.max(0.05, Number(val) || 0.55));
    if (masterGain && ctx) masterGain.gain.setValueAtTime(volume, ctx.currentTime);
  };

  function renderUi() {
    const btn = document.getElementById('pgAmbientBtn');
    if (btn) {
      if (!isPlaying) {
        btn.innerHTML = '<i class="fa-solid fa-music text-cyan-400"></i><span class="hidden sm:inline">بيانو هادئ</span>';
        btn.className = 'flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400/50 transition';
      } else if (!isPanelOpen) {
        btn.innerHTML = '<i class="fa-solid fa-volume-high text-emerald-400"></i><span class="hidden sm:inline">القائمة (يعمل)</span>';
        btn.className = 'flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300 transition';
      } else {
        btn.innerHTML = '<i class="fa-solid fa-volume-high text-emerald-400"></i><span class="hidden sm:inline">إيقاف البيانو</span>';
        btn.className = 'flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300 transition';
      }
    }

    let box = document.getElementById('pgYtPianoBox');
    if (!isPlaying || !isPanelOpen) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'pgYtPianoBox';
      box.className = 'fixed bottom-20 left-3 z-[85] w-72 rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-md lg:bottom-4';
      document.body.appendChild(box);
    }
    const piece = PIECES[pieceIdx % PIECES.length];
    box.innerHTML = `
      <div class="flex items-center justify-between gap-2 text-xs font-bold text-slate-200">
        <span class="flex items-center gap-1.5 truncate"><i class="fa-solid fa-music text-emerald-400"></i> ${piece.name}</span>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" onclick="pgNextPianoTrack()" class="rounded-lg bg-slate-800 px-2 py-1 text-[10px] text-sky-300 hover:bg-slate-700">تبديل</button>
          <button type="button" onclick="pgHidePianoPanel()" class="rounded-lg bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700" title="إخفاء القائمة مع استمرار العزف">إخفاء ▾</button>
          <button type="button" onclick="pgStopAmbientMusic()" class="rounded-lg bg-slate-800 px-2 py-1 text-[10px] text-rose-300 hover:bg-slate-700">إيقاف ✕</button>
        </div>
      </div>
      <div class="mt-2.5 flex items-center gap-2 text-[10px] text-slate-400">
        <i class="fa-solid fa-volume-low"></i>
        <input type="range" min="0.1" max="1" step="0.05" value="${volume}" oninput="pgSetPianoVolume(this.value)" class="w-full accent-cyan-400">
      </div>
    `;
  }

  function injectButton() {
    if (document.getElementById('pgAmbientBtn')) return;
    const headerActions = document.querySelector('header.sticky .mx-auto');
    if (!headerActions) return;
    const btn = document.createElement('button');
    btn.id = 'pgAmbientBtn';
    btn.type = 'button';
    btn.onclick = window.pgToggleAmbientMusic;
    btn.title = 'تشغيل / إيقاف موسيقى بيانو هادئة من داخل الموقع';
    const refChild = headerActions.children[1];
    if (refChild) headerActions.insertBefore(btn, refChild);
    else headerActions.appendChild(btn);
    renderUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();
