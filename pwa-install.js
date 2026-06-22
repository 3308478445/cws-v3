// ============ PWA 安装提示 ============
let deferredPrompt;
let installPromptShown = false;

// 监听 beforeinstallprompt 事件
window.addEventListener('beforeinstallprompt', (e) => {
    // 阻止默认的安装提示
    e.preventDefault();
    // 保存事件，以便稍后触发
    deferredPrompt = e;
    
    // 显示自定义安装提示（如果不是首次访问）
    if (!localStorage.getItem('pwa-installed') && !installPromptShown) {
        showInstallPrompt();
    }
});

// 显示安装提示
function showInstallPrompt() {
    // 创建安装提示元素
    const prompt = document.createElement('div');
    prompt.className = 'pwa-install-prompt';
    prompt.id = 'pwaInstallPrompt';
    prompt.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="flex: 1; min-width: 200px;">
                <strong style="font-size: 16px;">📱 安装到手机</strong>
                <div style="font-size: 14px; margin-top: 4px; opacity: 0.9;">添加到主屏幕，像App一样使用</div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="installPWA()" style="background: white; color: #f97316; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">
                    立即安装
                </button>
                <button onclick="dismissInstallPrompt()" style="background: transparent; color: white; border: 1px solid rgba(255,255,255,0.3); padding: 10px 20px; border-radius: 8px; cursor: pointer;">
                    暂不
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(prompt);
    
    // 延迟显示，让用户先看到内容
    setTimeout(() => {
        prompt.classList.add('show');
    }, 2000);
    
    installPromptShown = true;
}

// 安装PWA
function installPWA() {
    if (!deferredPrompt) {
        alert('请使用Chrome或Edge浏览器，点击右上角菜单→"安装应用"');
        return;
    }
    
    // 显示安装提示
    deferredPrompt.prompt();
    
    // 等待用户响应
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('用户接受了安装提示');
            localStorage.setItem('pwa-installed', 'true');
        } else {
            console.log('用户拒绝了安装提示');
        }
        // 清除保存的提示
        deferredPrompt = null;
        // 隐藏提示
        dismissInstallPrompt();
    });
}

// 关闭安装提示
function dismissInstallPrompt() {
    const prompt = document.getElementById('pwaInstallPrompt');
    if (prompt) {
        prompt.classList.remove('show');
        setTimeout(() => {
            prompt.remove();
        }, 300);
    }
}

// 监听应用安装完成
window.addEventListener('appinstalled', (e) => {
    console.log('PWA安装完成');
    localStorage.setItem('pwa-installed', 'true');
    dismissInstallPrompt();
    
    // 显示成功提示
    const successNotice = document.createElement('div');
    successNotice.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:12px 24px;border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    successNotice.textContent = '✅ 应用已安装到主屏幕';
    document.body.appendChild(successNotice);
    
    setTimeout(() => {
        successNotice.remove();
    }, 3000);
});

// 检测是否离线
window.addEventListener('offline', () => {
    showOfflineNotice();
});

window.addEventListener('online', () => {
    hideOfflineNotice();
});

function showOfflineNotice() {
    let notice = document.getElementById('offlineNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'offlineNotice';
        notice.className = 'offline-notice';
        notice.textContent = '⚠️ 当前离线，部分功能可能不可用';
        document.body.appendChild(notice);
    }
    notice.classList.add('show');
}

function hideOfflineNotice() {
    const notice = document.getElementById('offlineNotice');
    if (notice) {
        notice.classList.remove('show');
        setTimeout(() => {
            notice.remove();
        }, 300);
    }
}

// 页面加载时检查网络状态
window.addEventListener('load', () => {
    if (!navigator.onLine) {
        showOfflineNotice();
    }
});
