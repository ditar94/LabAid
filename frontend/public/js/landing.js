/* Nav scroll effect */
const nav = document.getElementById('nav');
let scrollTicking = false;
const onScroll = () => {
  if (!scrollTicking) {
    scrollTicking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
      scrollTicking = false;
    });
  }
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Scroll reveal */
const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); }});
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
reveals.forEach(el => revealObserver.observe(el));

/* Slideshow */
const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.dot');
let current = 0;
let timer;

function goTo(i) {
  slides[current].classList.remove('active');
  dots[current].classList.remove('active');
  current = i;
  slides[current].classList.add('active');
  dots[current].classList.add('active');
}

function advance() { goTo((current + 1) % slides.length); }

function startTimer() { timer = setInterval(advance, 4000); }
function resetTimer() { clearInterval(timer); startTimer(); }

dots.forEach(dot => {
  dot.addEventListener('click', () => { goTo(parseInt(dot.dataset.dot)); resetTimer(); });
});

startTimer();

/* Demo modal */
function openDemoModal() {
  document.getElementById('demo-overlay').classList.add('open');
  document.getElementById('demo-form-view').style.display = '';
  document.getElementById('demo-result-view').style.display = 'none';
  document.getElementById('demo-error').style.display = 'none';
  document.getElementById('demo-email').value = '';
  document.getElementById('demo-submit-btn').disabled = false;
  document.getElementById('demo-submit-btn').textContent = 'Start Demo';
  setTimeout(() => document.getElementById('demo-email').focus(), 100);
}
function closeDemoModal() {
  document.getElementById('demo-overlay').classList.remove('open');
}
// Close on overlay click (not modal itself)
document.getElementById('demo-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeDemoModal();
});
// Close on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeDemoModal();
});

async function handleDemoSubmit(e) {
  e.preventDefault();
  var email = document.getElementById('demo-email').value.trim();
  var btn = document.getElementById('demo-submit-btn');
  var errEl = document.getElementById('demo-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Setting up...';

  try {
    var res = await fetch('/api/demo/try', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: 'landing_page' }),
    });
    var data = await res.json();

    if (!res.ok) {
      var detail = data.detail || 'Something went wrong.';
      if (res.status === 429) {
        detail = 'Too many requests. Please wait a moment and try again.';
      }
      throw new Error(detail);
    }

    // Auto-login: redirect directly (local/beta)
    if (data.status === 'assigned' && data.auto_login && data.login_link) {
      document.getElementById('demo-form-view').style.display = 'none';
      document.getElementById('demo-result-view').style.display = '';
      document.getElementById('demo-result-view').innerHTML =
        '<div class="demo-result-icon">&#8987;</div>' +
        '<h3>Redirecting to your demo...</h3>';
      window.location.href = data.login_link;
      return;
    }

    // Show result
    document.getElementById('demo-form-view').style.display = 'none';
    var rv = document.getElementById('demo-result-view');
    rv.style.display = '';

    if (data.status === 'assigned') {
      var expires = data.expires_at ? '<p class="demo-expires">Expires ' + new Date(data.expires_at).toLocaleString() + '</p>' : '';
      rv.innerHTML =
        '<div class="demo-result-icon">&#9993;</div>' +
        '<h3>Check your email</h3>' +
        '<p>' + (data.message || ('We sent a login link to <strong>' + email + '</strong>. Click it to access your demo.')) + '</p>' +
        expires;
    } else if (data.status === 'waitlisted') {
      rv.innerHTML =
        '<div class="demo-result-icon">&#128203;</div>' +
        '<h3>You\'re on the list</h3>' +
        '<p>' + data.message + '</p>';
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Start Demo';
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}
// Make functions globally accessible
window.openDemoModal = openDemoModal;
window.closeDemoModal = closeDemoModal;
window.handleDemoSubmit = handleDemoSubmit;

/* Terms modal */
function openTermsModal() {
  document.getElementById('terms-overlay').classList.add('open');
}
function closeTermsModal() {
  document.getElementById('terms-overlay').classList.remove('open');
}
document.getElementById('terms-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeTermsModal();
});
window.openTermsModal = openTermsModal;
window.closeTermsModal = closeTermsModal;

/* Privacy modal */
function openPrivacyModal() {
  document.getElementById('privacy-overlay').classList.add('open');
}
function closePrivacyModal() {
  document.getElementById('privacy-overlay').classList.remove('open');
}
document.getElementById('privacy-overlay').addEventListener('click', function(e) {
  if (e.target === this) closePrivacyModal();
});
window.openPrivacyModal = openPrivacyModal;
window.closePrivacyModal = closePrivacyModal;

// Open modals if navigated with hash
if (window.location.hash === '#demo') openDemoModal();
if (window.location.hash === '#terms') openTermsModal();
if (window.location.hash === '#privacy') openPrivacyModal();
