/* Hanekom — horizontal item shelves (2026-11-19)
   Makes the homepage product rows swipeable left/right:
   - native touch swipe + scroll-snap (CSS)
   - round prev/next arrows (this file)
   - mouse drag-to-scroll on desktop
   - arrows hide themselves when a shelf fits without scrolling
   No dependencies; safe to defer. */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initShelf(wrap) {
    var shelf = wrap.querySelector('.product-grid.shelf');
    var prev = wrap.querySelector('.shelf-prev');
    var next = wrap.querySelector('.shelf-next');
    if (!shelf) return;

    var dragging = false;   // pointer is down and moving
    var moved = false;      // moved far enough to count as a drag
    var startX = 0, startLeft = 0, activePointer = null;

    function maxScroll() {
      return shelf.scrollWidth - shelf.clientWidth;
    }

    function behavior() {
      return reducedMotion ? 'auto' : 'smooth';
    }

    function update() {
      var overflows = maxScroll() > 4;
      if (prev) {
        prev.disabled = !overflows || shelf.scrollLeft <= 2;
        prev.setAttribute('aria-hidden', prev.disabled ? 'true' : 'false');
      }
      if (next) {
        next.disabled = !overflows || shelf.scrollLeft >= maxScroll() - 2;
        next.setAttribute('aria-hidden', next.disabled ? 'true' : 'false');
      }
      shelf.classList.toggle('no-overflow', !overflows);
      wrap.classList.toggle('no-overflow', !overflows);
    }

    function page(dir) {
      /* advance roughly one visible page, then let scroll-snap settle
         on the nearest card edge */
      shelf.scrollBy({ left: dir * shelf.clientWidth * 0.9, behavior: behavior() });
    }

    if (prev) prev.addEventListener('click', function () { page(-1); });
    if (next) next.addEventListener('click', function () { page(1); });

    /* --- mouse drag-to-scroll (touch devices swipe natively) --- */
    shelf.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (shelf.classList.contains('no-overflow')) return;
      dragging = true;
      moved = false;
      activePointer = e.pointerId;
      startX = e.clientX;
      startLeft = shelf.scrollLeft;
    });

    shelf.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        shelf.classList.add('is-dragging');
        try { shelf.setPointerCapture(activePointer); } catch (err) { /* noop */ }
      }
      if (moved) shelf.scrollLeft = startLeft - dx;
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      shelf.classList.remove('is-dragging');
      if (moved) {
        /* settle on the nearest snap point manually (snap was disabled
           during the drag so it would not fight the pointer) */
        var step = 0;
        var card = shelf.querySelector('.product');
        if (card) {
          var gap = 12.8; /* .8rem fallback; measured below when possible */
          var s = getComputedStyle(shelf);
          if (s.columnGap) gap = parseFloat(s.columnGap) || 0;
          step = card.getBoundingClientRect().width + gap;
        }
        var target = Math.round(shelf.scrollLeft / (step || 1)) * (step || 1);
        shelf.scrollTo({ left: target, behavior: behavior() });
      }
      moved = false;
      activePointer = null;
    }

    shelf.addEventListener('pointerup', endDrag);
    shelf.addEventListener('pointercancel', endDrag);
    shelf.addEventListener('pointerleave', endDrag);

    /* swallow the click that follows a drag so cards/links do not fire */
    shelf.addEventListener('click', function (e) {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    /* keep arrow states fresh */
    var raf = null;
    shelf.addEventListener('scroll', function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () { raf = null; update(); });
    }, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('load', update);
    update();
  }

  function boot() {
    document.querySelectorAll('.shelf-wrap').forEach(initShelf);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
