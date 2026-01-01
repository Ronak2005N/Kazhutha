// GlassEffect/glass.js
// Theme toggle logic: purely visual, non-invasive, persists preference.

(function () {
  // Manages the Theme -> submenu -> Glass Effect UX.
  let submenu = null;
  let open = false;
  let outsideHandler = null;
  let resizeHandler = null;

  function findThemeLink() {
    const anchors = Array.from(document.querySelectorAll('.hamburger-menu-item'));
    return anchors.find(a => a.textContent && a.textContent.trim().toLowerCase() === 'theme');
  }

  function isGlassEnabled() {
    return document.body.classList.contains('glass-theme');
  }

  function setGlassEnabled(enabled) {
    if (enabled) document.body.classList.add('glass-theme');
    else document.body.classList.remove('glass-theme');
    try { localStorage.setItem('glassTheme', enabled ? '1' : '0'); } catch (e) {}
    updateCheckMark();
  }

  function applySaved() {
    try {
      if (localStorage.getItem('glassTheme') === '1') document.body.classList.add('glass-theme');
    } catch (e) {}
    // ensure checkmark will be correct once submenu is created
  }

  function createSubmenu(anchor) {
    if (submenu) return submenu;
    submenu = document.createElement('div');
    submenu.className = 'glass-theme-submenu';
    submenu.setAttribute('role', 'menu');
    submenu.innerHTML = `
      <div class="glass-theme-submenu-item" role="menuitem" data-action="toggle-glass">
        <span class="glass-theme-label">Carbon Theme</span>
        <span class="glass-theme-check" aria-hidden="true"></span>
      </div>
    `;

    document.body.appendChild(submenu);

    // click on submenu item
    submenu.addEventListener('click', function (ev) {
      const item = ev.target.closest('.glass-theme-submenu-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      if (action === 'toggle-glass') {
        setGlassEnabled(!isGlassEnabled());
      }
    });

    return submenu;
  }

  function updateCheckMark() {
    if (!submenu) return;
    const check = submenu.querySelector('.glass-theme-check');
    if (!check) return;
    if (isGlassEnabled()) check.textContent = '✓'; else check.textContent = '';
  }

  function positionSubmenu(anchor) {
    if (!submenu) return;
    const rect = anchor.getBoundingClientRect();
    // position directly under the anchor, avoid layout shifts by using fixed positioning
    const top = rect.bottom + 6 + window.scrollY;
    const left = rect.left + window.scrollX;
    submenu.style.top = top + 'px';
    submenu.style.left = left + 'px';
  }

  function openSubmenu(anchor) {
    createSubmenu(anchor);
    positionSubmenu(anchor);
    submenu.classList.add('show');
    open = true;
    updateCheckMark();

    outsideHandler = function (ev) {
      if (!submenu) return;
      if (ev.target === anchor || submenu.contains(ev.target) || anchor.contains(ev.target)) return;
      closeSubmenu();
    };
    document.addEventListener('click', outsideHandler);

    resizeHandler = function () { positionSubmenu(anchor); };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, { passive: true });

    document.addEventListener('keydown', handleKeydown);
  }

  function closeSubmenu() {
    if (!submenu) return;
    submenu.classList.remove('show');
    open = false;
    if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); window.removeEventListener('scroll', resizeHandler); resizeHandler = null; }
    document.removeEventListener('keydown', handleKeydown);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeSubmenu();
  }

  document.addEventListener('DOMContentLoaded', function () {
    const anchor = findThemeLink();
    applySaved();
    if (!anchor) return;

    // make sure the anchor does not navigate; it should open submenu
    anchor.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (open) closeSubmenu(); else openSubmenu(anchor);
    });

    // create submenu now (hidden) so checkmark can be updated immediately
    createSubmenu(anchor);
    updateCheckMark();
  });

})();
