const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

function openTermsModal() { document.getElementById('terms-overlay').classList.add('open'); }
function closeTermsModal() { document.getElementById('terms-overlay').classList.remove('open'); }
document.getElementById('terms-overlay').addEventListener('click', function(e) { if (e.target === this) closeTermsModal(); });

function openPrivacyModal() { document.getElementById('privacy-overlay').classList.add('open'); }
function closePrivacyModal() { document.getElementById('privacy-overlay').classList.remove('open'); }
document.getElementById('privacy-overlay').addEventListener('click', function(e) { if (e.target === this) closePrivacyModal(); });
