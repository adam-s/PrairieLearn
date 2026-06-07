import { onDocumentReady } from '@prairielearn/browser-utils';

const CLASS = 'js-collapsible-card-body';

function maybeToggleCard(target: HTMLElement, show: boolean) {
  if (!target.classList.contains(CLASS)) return;

  target
    .closest('.card')
    ?.querySelector<HTMLDivElement>('.collapsible-card-header')
    ?.classList.toggle('border-bottom-0', !show);

  persistCollapsedState(target, !show);
}

// Cards that opt in to persistence carry a `data-storage-key`. The collapsed
// state is stored per key in localStorage so it survives page/variant reloads
// (mirrors the per-question persistence used by the calculator drawer).
function storageKeyFor(target: HTMLElement): string | null {
  return target.closest<HTMLElement>('.card[data-storage-key]')?.dataset.storageKey ?? null;
}

function persistCollapsedState(target: HTMLElement, collapsed: boolean) {
  const key = storageKeyFor(target);
  if (!key) return;
  try {
    localStorage.setItem(key, collapsed ? '1' : '0');
  } catch {
    // localStorage may be unavailable (private mode, quota); persistence is best-effort.
  }
}

// On load, restore the persisted collapsed state for any opted-in card. We set
// the exact DOM Bootstrap produces for a collapsed card (no animation, no flash):
// the body loses `show`/gains `collapse`; the toggle gains `collapsed` +
// `aria-expanded="false"`. Bootstrap then reads this state on the first toggle.
function restoreCollapsedState() {
  for (const card of document.querySelectorAll<HTMLElement>('.card[data-storage-key]')) {
    const body = card.querySelector<HTMLElement>(`.${CLASS}`);
    if (!body) continue;

    let collapsed: boolean;
    try {
      collapsed = localStorage.getItem(card.dataset.storageKey ?? '') === '1';
    } catch {
      continue;
    }
    if (!collapsed) continue;

    body.classList.remove('show');
    body.classList.add('collapse');
    card.querySelector<HTMLElement>('.collapsible-card-header')?.classList.add('border-bottom-0');

    const toggle = body.id
      ? card.querySelector<HTMLElement>(`[data-bs-target="#${body.id}"]`)
      : card.querySelector<HTMLElement>('[data-bs-toggle="collapse"]');
    toggle?.classList.add('collapsed');
    toggle?.setAttribute('aria-expanded', 'false');
  }
}

onDocumentReady(restoreCollapsedState);

document.addEventListener('show.bs.collapse', (e) => {
  maybeToggleCard(e.target as HTMLElement, true);
});

document.addEventListener('hidden.bs.collapse', (e) => {
  maybeToggleCard(e.target as HTMLElement, false);
});
