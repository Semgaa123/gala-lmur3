document.addEventListener('DOMContentLoaded', () => {
    console.log('GalaLMur — страница загружена');

    const cartCountEl = document.getElementById('cartCount');
    const toastOverlay = document.getElementById('toastOverlay');
    const toastBackdrop = document.getElementById('toastBackdrop');
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    const toastClose = document.getElementById('toastClose');

    let currentFilter = 'all';
    let selectedSizes = [];
    let toastTimer = null;

    async function updateCartCount() {
        try { const res = await fetch('/api/cart'); const data = await res.json(); if (cartCountEl && data.cart) cartCountEl.textContent = data.cart.length; } catch(e) {}
    }
    updateCartCount();

    async function checkAuth() {
        try {
            const res = await fetch('/api/me'); const data = await res.json();
            if (data.loggedIn) {
                document.getElementById('userGreeting').textContent = data.user.name;
                document.getElementById('authBtn').style.display = 'none';
                document.getElementById('userMenu').style.display = 'inline-block';
                if (data.user.role === 'admin') document.getElementById('adminLink').style.display = 'block';
                updateCartCount();
            }
        } catch(e) {}
    }
    checkAuth();

    function showToast(message, isError = false) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.classList.remove('toast--success', 'toast--error');
        toast.classList.add(isError ? 'toast--error' : 'toast--success');
        toastIcon.textContent = isError ? '✗' : '✓';
        toastMessage.textContent = message;
        toastOverlay.classList.add('toast-overlay--show'); toastBackdrop.classList.add('toast-backdrop--show');
        toastTimer = setTimeout(hideToast, 5000);
    }
    function hideToast() { toastOverlay.classList.remove('toast-overlay--show'); toastBackdrop.classList.remove('toast-backdrop--show'); if (toastTimer) clearTimeout(toastTimer); }
    toastClose.addEventListener('click', hideToast);
    toastBackdrop.addEventListener('click', hideToast);

    // КАТАЛОГ
    async function loadCatalogDresses() {
        try {
            const res = await fetch('/api/dresses');
            window.catalogDresses = (await res.json()).map(d => ({ id: d.id, name: d.title, price: d.price_per_day, desc: d.description, img: d.image_url || null, sizes: d.sizes, category: d.category }));
            renderAllDresses();
        } catch(e) {}
    }

    function renderAllDresses() {
        const grid = document.getElementById('dressesGrid');
        if (!window.catalogDresses || !window.catalogDresses.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999;">Нет доступных нарядов</div>'; return; }
        let dressesToShow = window.catalogDresses;
        if (currentFilter === 'wedding') dressesToShow = dressesToShow.filter(d => d.category === 'wedding');
        else if (currentFilter === 'evening') dressesToShow = dressesToShow.filter(d => d.category === 'evening');
        else if (currentFilter === 'suit') dressesToShow = dressesToShow.filter(d => d.category === 'suit');
        else if (currentFilter === 'accessories') dressesToShow = dressesToShow.filter(d => d.category === 'accessories');
        if (currentFilter !== 'accessories' && selectedSizes.length > 0) dressesToShow = dressesToShow.filter(d => selectedSizes.some(s => d.sizes.split(',').map(x => x.trim()).includes(s)));
        if (!dressesToShow.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#999;">Нет нарядов</div>'; return; }
        grid.innerHTML = dressesToShow.map(d => {
            const images = d.img ? d.img.split(',') : [''];
            return `<article class="card" onclick="openDetailModal('${d.name.replace(/'/g, "\\'")}', ${d.price}, '${(d.desc||'').replace(/'/g, "\\'")}', '${d.sizes}', '${d.img||''}', '${d.category}')">
                <div class="card__img-wrapper"><img src="${images[0]}" alt="${d.name}" class="card__img" onerror="this.parentElement.innerHTML='<div style=display:flex;align-items:center;justify-content:center;height:100%;font-size:18px;color:#999;>Нет фото</div>';"></div>
                <div class="card__body"><h2 class="card__title">${d.name}</h2><p class="card__price">${d.price.toLocaleString('ru-RU')} ₽ / день</p><p class="card__desc">${d.desc||''}</p><p class="card__sizes">Размеры: ${d.sizes}</p></div></article>`;
        }).join('');
    }

   window.filterCategory = function(cat) {
    currentFilter = cat;
    const sidebar = document.getElementById('sizeFilterSidebar');
    if (cat === 'accessories') {
        sidebar.style.display = 'none';
        document.querySelector('.main__grid').style.gridTemplateColumns = '1fr';
    } else {
        sidebar.style.display = 'block';
        document.querySelector('.main__grid').style.gridTemplateColumns = '200px 1fr';
    }
    renderAllDresses();
};
    window.applySizeFilter = function() { selectedSizes = []; document.querySelectorAll('.size-filter:checked').forEach(cb => selectedSizes.push(cb.value)); renderAllDresses(); };

    // ДЕТАЛИ
    window.openDetailModal = function(name, price, desc, sizes, img, category) {
        document.getElementById('detailTitle').textContent = name;
        document.getElementById('detailPrice').textContent = price.toLocaleString('ru-RU') + ' ₽ / день';
        document.getElementById('detailDesc').textContent = desc;
        document.getElementById('detailSizes').textContent = 'Размеры: ' + sizes;
        const images = img ? img.split(',') : [''];
        window._detailImages = images; window._detailIndex = 0;
        updateDetailImage();
        document.getElementById('detailPrev').style.display = images.length > 1 ? 'flex' : 'none';
        document.getElementById('detailNext').style.display = images.length > 1 ? 'flex' : 'none';
        document.getElementById('detailCartBtn').onclick = () => addToCart(name, price, img, sizes);
        document.getElementById('detailModal').style.display = 'flex';
    };
    window.closeDetailModal = function() { document.getElementById('detailModal').style.display = 'none'; };
    document.getElementById('detailModal').addEventListener('click', function(e) { if (e.target === this) closeDetailModal(); });

    function updateDetailImage() {
        const imgs = window._detailImages || [''], idx = window._detailIndex || 0;
        document.getElementById('detailMainImage').src = imgs[idx] || '';
        const counter = document.getElementById('detailImageCounter');
        if (imgs.length > 1) { counter.textContent = (idx+1) + ' / ' + imgs.length; counter.style.display = 'block'; }
        else counter.style.display = 'none';
    }
    window.prevDetailImage = function(e) { e.stopPropagation(); const imgs = window._detailImages||[]; if (imgs.length<=1) return; window._detailIndex = (window._detailIndex-1+imgs.length)%imgs.length; updateDetailImage(); };
    window.nextDetailImage = function(e) { e.stopPropagation(); const imgs = window._detailImages||[]; if (imgs.length<=1) return; window._detailIndex = (window._detailIndex+1)%imgs.length; updateDetailImage(); };

    window.openFullscreen = function(element) {
        const img = element.querySelector('img'); if (!img || !img.src) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        const fullImg = document.createElement('img'); fullImg.src = img.src;
        fullImg.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;transition:transform 0.3s;';
        let scale = 1;
        fullImg.addEventListener('click', function(e) { e.stopPropagation(); scale = scale===1?2.5:1; fullImg.style.transform=`scale(${scale})`; fullImg.style.cursor = scale===1?'zoom-in':'zoom-out'; });
        overlay.addEventListener('click', () => overlay.remove());
        overlay.appendChild(fullImg); document.body.appendChild(overlay);
    };

    async function addToCart(name, price, img, sizes) {
        const res = await fetch('/api/cart', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ dress_name: name, dress_price: price, dress_image: img, dress_sizes: sizes }) });
        const data = await res.json();
        showNotification(data.message, !data.success); if (data.success) updateCartCount();
    }
    function showNotification(message, isError) {
        const n = document.createElement('div'); n.textContent = message;
        n.style.cssText = `position:fixed;top:20px;right:20px;background:${isError?'#f44336':'#4CAF50'};color:#fff;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 15px rgba(0,0,0,0.2);animation:slideIn 0.3s ease;max-width:350px;`;
        document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
    }

    // АВТОРИЗАЦИЯ
    function openAuthModal() { document.getElementById('authModal').style.display = 'flex'; }
    function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }
    document.getElementById('authBtn').addEventListener('click', function(e) { e.preventDefault(); openAuthModal(); });
    document.getElementById('authModal').addEventListener('click', function(e) { if (e.target === this) closeAuthModal(); });
    window.switchTab = function(tab) {
        document.getElementById('form-login').style.display = tab==='login'?'block':'none';
        document.getElementById('form-register').style.display = tab==='register'?'block':'none';
        document.getElementById('tabLoginBtn').style.background = tab==='login'?'#8B6B4A':'#A08060';
        document.getElementById('tabRegisterBtn').style.background = tab==='register'?'#8B6B4A':'#A08060';
    };
    window.register = async function() {
        const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ full_name:document.getElementById('regName').value, email:document.getElementById('regEmail').value, phone:document.getElementById('regPhone').value, password:document.getElementById('regPassword').value }) });
        const data = await res.json(); showToast(data.message, !data.success); if (data.success) { closeAuthModal(); checkAuth(); }
    };
    window.login = async function() {
        const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:document.getElementById('loginEmail').value, password:document.getElementById('loginPassword').value }) });
        const data = await res.json(); showToast(data.message, !data.success); if (data.success) { closeAuthModal(); checkAuth(); }
    };
    window.logout = async function() {
        await fetch('/api/logout', { method:'POST' });
        document.getElementById('userGreeting').textContent = ''; document.getElementById('authBtn').style.display = 'inline';
        document.getElementById('userMenu').style.display = 'none'; document.getElementById('adminLink').style.display = 'none';
        cartCountEl.textContent = '0'; showToast('Вы вышли', false);
    };

    // ПОДДЕРЖКА
    window.openSupportModal = function() { document.getElementById('supportModal').style.display = 'flex'; };
    window.closeSupportModal = function() { document.getElementById('supportModal').style.display = 'none'; };
    document.getElementById('supportModal').addEventListener('click', function(e) { if (e.target === this) closeSupportModal(); });
    window.sendSupportMessage = async function() {
        const n = document.getElementById('supportName').value, e = document.getElementById('supportEmail').value, m = document.getElementById('supportMessage').value;
        if (!n||!e||!m) { showToast('Заполните все поля', true); return; }
        await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ user_name:n, user_email:e, message:m }) });
        showToast('Сообщение отправлено!', false); closeSupportModal();
    };

    window.openAuthModal = openAuthModal; window.closeAuthModal = closeAuthModal;
    window.filterCategory = filterCategory; window.applySizeFilter = applySizeFilter;
    loadCatalogDresses();
});