export class StatusBadge {
    private el: any;
    private startTime: number = 0;
    private timer: any = null;
    private textSpan: any = null;

    constructor(containerId: string) {
        const container = document.getElementById(containerId);
        if (!container) return;
        this.el = document.createElement('div');
        this.el.style.fontSize = '12px';
        this.el.style.padding = '4px 8px';
        this.el.style.borderRadius = '4px';
        this.el.style.display = 'inline-flex';
        this.el.style.alignItems = 'center';
        this.el.style.gap = '6px';
        container.appendChild(this.el);
    }

    public startLoading(message: string) {
        if (!this.el) return;
        this.stopTimer();
        this.startTime = Date.now();
        this.el.style.backgroundColor = '#eff6ff';
        this.el.style.color = '#1e40af';

        // Inject the spin keyframe once
        if (!document.getElementById('sqlnb-spin-style')) {
            const style = document.createElement('style');
            style.id = 'sqlnb-spin-style';
            style.textContent = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }

        // Build the DOM once so the SVG animation is never interrupted
        this.el.innerHTML = '';

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.animation = 'spin 1s linear infinite';
        svg.style.flexShrink = '0';
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', 'M21 12a9 9 0 1 1-6.219-8.56');
        svg.appendChild(path);
        this.el.appendChild(svg);

        this.textSpan = document.createElement('span');
        this.el.appendChild(this.textSpan);

        // Only update the text node on each tick — never touch the SVG
        const tick = () => {
            const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
            if (this.textSpan) this.textSpan.textContent = `${message} (${elapsed}s)`;
        };
        tick();
        this.timer = setInterval(tick, 100);
    }

    public setSuccess(message: string, elapsedMs?: number) {
        if (!this.el) return;
        this.stopTimer();
        this.el.style.backgroundColor = '#f0fdf4';
        this.el.style.color = '#166534';

        const checkSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

        let timeStr = '';
        if (elapsedMs !== undefined) {
            timeStr = elapsedMs < 1000 ? `${elapsedMs.toFixed(0)}ms` : `${(elapsedMs / 1000).toFixed(2)}s`;
        } else {
            const ms = Date.now() - this.startTime;
            timeStr = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        }

        this.el.innerHTML = `${checkSvg} <span>${message} · ${timeStr}</span>`;
        this.textSpan = null;
    }

    public setError(error: string) {
        if (!this.el) return;
        this.stopTimer();
        this.el.style.backgroundColor = '#fef2f2';
        this.el.style.color = '#991b1b';

        const errSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;

        this.el.innerHTML = `${errSvg} <span>${error}</span>`;
        this.textSpan = null;
    }

    public setInfo(message: string) {
        if (!this.el) return;
        this.stopTimer();
        this.el.style.backgroundColor = '#f3f4f6';
        this.el.style.color = '#374151';

        const infoSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

        this.el.innerHTML = `${infoSvg} <span>${message}</span>`;
        this.textSpan = null;
    }

    private stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.textSpan = null;
    }
}
