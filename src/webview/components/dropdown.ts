export function initCustomSelects() {
    // Clean up old menus
    document.querySelectorAll('.custom-select-menu').forEach(m => m.remove());

    const selects = document.querySelectorAll('select.sqlnb-select:not([data-initialized])');
    selects.forEach((selectEl: any) => {
        selectEl.setAttribute('data-initialized', 'true');
        selectEl.style.display = 'none';

        const container = document.createElement('div');
        container.className = 'custom-select-container';
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger sqlnb-input'; // use same border/bg
        
        const arrow = document.createElement('div');
        arrow.className = 'custom-select-arrow';
        arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

        const valueSpan = document.createElement('span');
        valueSpan.className = 'custom-select-value';

        trigger.appendChild(valueSpan);
        trigger.appendChild(arrow);
        container.appendChild(trigger);
        
        selectEl.parentNode.insertBefore(container, selectEl);
        container.appendChild(selectEl); // move select inside

        const updateTrigger = () => {
            const selectedOpt = selectEl.options[selectEl.selectedIndex];
            valueSpan.innerText = selectedOpt ? selectedOpt.innerText : '';
        };
        updateTrigger();
        
        // Listen to original select changes if modified programmatically
        selectEl.addEventListener('change', updateTrigger);

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other menus
            document.querySelectorAll('.custom-select-menu').forEach(m => m.remove());
            
            const menu = document.createElement('div');
            menu.className = 'custom-select-menu';
            
            Array.from(selectEl.options).forEach((opt: any) => {
                const item = document.createElement('div');
                item.className = 'custom-select-item';
                if (opt.selected) item.classList.add('selected');
                item.innerText = opt.innerText;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectEl.value = opt.value;
                    updateTrigger();
                    menu.remove();
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                });
                menu.appendChild(item);
            });

            document.body.appendChild(menu);
            const rect = trigger.getBoundingClientRect();
            menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
            menu.style.left = (rect.left + window.scrollX) + 'px';
            menu.style.width = rect.width + 'px';
        });
    });
}

export function initCustomAutocompletes(recentConnections: string[]) {
    const inputs = document.querySelectorAll('input.conn-input:not([data-initialized])');
    inputs.forEach((inputEl: any) => {
        inputEl.setAttribute('data-initialized', 'true');
        
        // Remove native datalist to use custom
        inputEl.removeAttribute('list');

        const container = document.createElement('div');
        container.className = 'custom-autocomplete-container';
        
        inputEl.parentNode.insertBefore(container, inputEl);
        container.appendChild(inputEl);

        const arrow = document.createElement('div');
        arrow.className = 'custom-select-arrow';
        arrow.style.position = 'absolute';
        arrow.style.right = '10px';
        arrow.style.top = '50%';
        arrow.style.transform = 'translateY(-50%)';
        arrow.style.cursor = 'pointer';
        arrow.style.color = 'var(--text-muted)';
        arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        container.appendChild(arrow);

        let menu: HTMLDivElement | null = null;

        const closeMenu = () => {
            if (menu) {
                menu.remove();
                menu = null;
            }
        };

        const showMenu = () => {
            closeMenu();
            if (recentConnections.length === 0) return;
            
            document.querySelectorAll('.custom-select-menu').forEach(m => m.remove());

            menu = document.createElement('div');
            menu.className = 'custom-select-menu conn-autocomplete-menu';
            
            const filtered = recentConnections;

            filtered.forEach(conn => {
                const item = document.createElement('div');
                item.className = 'custom-select-item';
                item.innerText = conn;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    inputEl.value = conn;
                    closeMenu();
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                });
                menu!.appendChild(item);
            });

            document.body.appendChild(menu);
            const rect = inputEl.getBoundingClientRect();
            menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
            menu.style.left = (rect.left + window.scrollX) + 'px';
            menu.style.width = rect.width + 'px';
        };

        inputEl.addEventListener('focus', showMenu);
        arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            if (menu) closeMenu();
            else showMenu();
        });
        
        inputEl.addEventListener('input', () => {
            if (!menu) showMenu();
            else {
                // Filter items
                const val = inputEl.value.toLowerCase();
                const items = menu.querySelectorAll('.custom-select-item');
                let hasVisible = false;
                items.forEach((item: any) => {
                    if (item.innerText.toLowerCase().includes(val)) {
                        item.style.display = 'block';
                        hasVisible = true;
                    } else {
                        item.style.display = 'none';
                    }
                });
                if (!hasVisible) closeMenu();
            }
        });
    });
}

document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-menu').forEach(m => m.remove());
});
