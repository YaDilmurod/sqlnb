/**
 * Unified Modal System — shared overlay/close/scroll-lock logic for all modals.
 * Provides `openModal` and `closeModal` to keep modal code DRY.
 */

declare const document: any;

const CLOSE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/** Active modal Esc handlers — keyed by modal ID so we can clean up on close. */
const escHandlers = new Map<string, (e: KeyboardEvent) => void>();

export interface ModalOptions {
  /** Unique ID for the modal (used for DOM lookup and preventing duplicates). */
  id: string;
  /** Header title text (can contain HTML). */
  title: string;
  /** Optional SVG icon HTML for the header. */
  icon?: string;
  /** Optional subtitle text shown after title (styled muted). */
  subtitle?: string;
  /** Size preset: sm=520px, md=800px, lg=1000px, full=90vw×80vh. Default: 'md'. */
  size?: 'sm' | 'md' | 'lg' | 'full';
  /** Initial body HTML content. */
  bodyHtml?: string;
  /** Optional footer HTML content. */
  footerHtml?: string;
  /** Callback invoked when modal is closed (by any mechanism). */
  onClose?: () => void;
  /** Extra HTML injected into the header right side (e.g. meta text, spinners). */
  headerRight?: string;
}

export interface ModalHandle {
  /** The overlay element (root). */
  overlay: HTMLElement;
  /** The body content container — callers inject their content here. */
  body: HTMLElement;
  /** The footer container (may be empty if no footerHtml). */
  footer: HTMLElement | null;
  /** Programmatically close this modal. */
  close: () => void;
  /** Update the body content. */
  setBody: (html: string) => void;
  /** Update the header title. */
  setTitle: (html: string) => void;
  /** Update the header right area (meta text, spinner, etc.). */
  setHeaderRight: (html: string) => void;
}

/**
 * Open a modal with consistent overlay, header, close button, Esc handler, and scroll lock.
 * If a modal with the same ID already exists, it is removed first.
 */
export function openModal(opts: ModalOptions): ModalHandle {
  // Remove existing modal with same ID
  closeModal(opts.id);

  const size = opts.size || 'md';

  const overlay = document.createElement('div');
  overlay.id = `sqlnb-modal-${opts.id}`;
  overlay.className = 'sqlnb-modal-overlay';

  const iconHtml = opts.icon ? `<span class="sqlnb-modal-icon">${opts.icon}</span>` : '';
  const subtitleHtml = opts.subtitle ? `<span class="sqlnb-modal-subtitle">${opts.subtitle}</span>` : '';
  const headerRightHtml = opts.headerRight ? `<div class="sqlnb-modal-header-right">${opts.headerRight}</div>` : '';
  const footerHtml = opts.footerHtml ? `<div class="sqlnb-modal-footer" id="sqlnb-modal-footer-${opts.id}">${opts.footerHtml}</div>` : '';

  overlay.innerHTML = `
    <div class="sqlnb-modal sqlnb-modal-${size}">
      <div class="sqlnb-modal-header">
        <div class="sqlnb-modal-title">
          ${iconHtml}
          <span id="sqlnb-modal-title-text-${opts.id}">${opts.title}</span>
          ${subtitleHtml}
        </div>
        <div class="sqlnb-modal-header-actions">
          <span id="sqlnb-modal-header-right-${opts.id}">${headerRightHtml ? opts.headerRight : ''}</span>
          <button class="sqlnb-modal-close" title="Close (Esc)">${CLOSE_SVG}</button>
        </div>
      </div>
      <div class="sqlnb-modal-body" id="sqlnb-modal-body-${opts.id}">
        ${opts.bodyHtml || ''}
      </div>
      ${footerHtml}
    </div>
  `;

  document.body.appendChild(overlay);

  // Disable background scrolling
  document.body.style.overflow = 'hidden';

  const body = overlay.querySelector(`#sqlnb-modal-body-${opts.id}`) as HTMLElement;
  const footer = overlay.querySelector(`#sqlnb-modal-footer-${opts.id}`) as HTMLElement | null;

  // Close function
  function close() {
    closeModal(opts.id);
  }

  // Wire close handlers
  const closeBtn = overlay.querySelector('.sqlnb-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Overlay click (only if clicking the backdrop itself)
  overlay.addEventListener('click', (e: any) => {
    if (e.target === overlay) close();
  });

  // Esc key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  escHandlers.set(opts.id, escHandler);
  document.addEventListener('keydown', escHandler);

  // Store onClose callback on the overlay element for closeModal to call
  if (opts.onClose) {
    (overlay as any)._onClose = opts.onClose;
  }

  return {
    overlay,
    body,
    footer,
    close,
    setBody(html: string) {
      if (body) body.innerHTML = html;
    },
    setTitle(html: string) {
      const el = overlay.querySelector(`#sqlnb-modal-title-text-${opts.id}`);
      if (el) el.innerHTML = html;
    },
    setHeaderRight(html: string) {
      const el = overlay.querySelector(`#sqlnb-modal-header-right-${opts.id}`);
      if (el) el.innerHTML = html;
    },
  };
}

/**
 * Close and remove a modal by its ID. Restores body scroll and cleans up Esc handler.
 */
export function closeModal(id: string): void {
  const overlay = document.getElementById(`sqlnb-modal-${id}`);
  if (!overlay) return;

  // Call onClose callback if set
  if ((overlay as any)._onClose) {
    try { (overlay as any)._onClose(); } catch {}
  }

  overlay.remove();

  // Clean up Esc handler
  const handler = escHandlers.get(id);
  if (handler) {
    document.removeEventListener('keydown', handler);
    escHandlers.delete(id);
  }

  // Restore body scroll only if no other modals are open
  const anyOpen = document.querySelector('.sqlnb-modal-overlay');
  if (!anyOpen) {
    document.body.style.overflow = '';
  }
}
