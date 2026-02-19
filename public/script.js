/**
 * Earn Secret — Landing Page
 *
 * Simple flow: collect game + secret, store in sessionStorage, redirect to /room/:id
 * The room page handles ALL WebSocket logic. No WS here at all.
 */

const state = { selectedGame: null };

const navbar        = document.getElementById('navbar');
const heroCta       = document.getElementById('hero-cta');
const navCta        = document.getElementById('nav-cta');
const modalOverlay  = document.getElementById('modal-overlay');
const modalClose    = document.getElementById('modal-close');
const stepGame      = document.getElementById('step-game');
const stepSecret    = document.getElementById('step-secret');
const stepShare     = document.getElementById('step-share');
const secretInput   = document.getElementById('secret-input');
const charCount     = document.getElementById('char-count');
const createRoomBtn = document.getElementById('create-room-btn');
const createSpinner = document.getElementById('create-spinner');

window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 20));

const ro = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.15 });
document.querySelectorAll('.animate-reveal').forEach(el => ro.observe(el));

function openModal(gameType = null) {
  if (gameType) { state.selectedGame = gameType; showStep('secret'); }
  else showStep('game');
  modalOverlay.classList.add('active');
  if (gameType) setTimeout(() => secretInput.focus(), 300);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  setTimeout(() => {
    showStep('game');
    state.selectedGame = null;
    secretInput.value = '';
    charCount.textContent = '0';
    removeError();
  }, 300);
}

function showStep(name) {
  ['game','secret','share'].forEach(s =>
    document.getElementById('step-' + s).classList.toggle('hidden', s !== name));
}

heroCta.addEventListener('click', () => openModal());
navCta.addEventListener('click',  () => openModal());
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.querySelectorAll('.modal-game-option').forEach(btn => {
  btn.addEventListener('click', () => {
    state.selectedGame = btn.dataset.game;
    showStep('secret');
    setTimeout(() => secretInput.focus(), 100);
  });
});

document.querySelectorAll('.game-play-btn').forEach(btn => {
  btn.addEventListener('click', e => { e.stopPropagation(); openModal(btn.dataset.game); });
});

secretInput.addEventListener('input', () => { charCount.textContent = secretInput.value.length; });

createRoomBtn.addEventListener('click', () => {
  const secret = secretInput.value.trim();
  if (!secret) {
    secretInput.style.borderColor = '#ef4444';
    setTimeout(() => secretInput.style.borderColor = '', 1500);
    secretInput.focus();
    return;
  }
  if (!state.selectedGame) { showError('Please select a game first.'); return; }

  // Random 8-char room ID
  const roomId = Math.random().toString(36).slice(2, 10);

  // Store everything — room.js will read this and create the room over WS
  sessionStorage.setItem('es_pending', JSON.stringify({
    roomId,
    gameType: state.selectedGame,
    secret
  }));

  window.location.href = '/room/' + roomId;
});

function showError(msg) {
  removeError();
  const el = document.createElement('p');
  el.id = 'modal-error';
  el.style.cssText = 'color:#ef4444;font-size:0.85rem;text-align:center;margin-top:0.5rem;';
  el.textContent = msg;
  createRoomBtn.insertAdjacentElement('afterend', el);
  setTimeout(removeError, 4000);
}
function removeError() { document.getElementById('modal-error')?.remove(); }