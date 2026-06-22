// ============ 催收工作台 v3.0 ============

// ---- Constants ----
const DEFAULT_LPR = 3.0;
const LICENSED_RATE_CAP = 24.0;
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365;
const DEFAULT_DAILY_RATE = 0.05;
const STORAGE_KEY = 'cws_v3_cases';
const TOKEN_KEY = 'cws_v3_gh_token';
const REPO_OWNER = '3308478445';
const REPO_NAME = 'collector-assistant';
const DATA_PATH = 'data/cases.json';

const STATUSES = ['pending','contacted','promised','resolved','failed'];
const STATUS_LABELS = {
    pending: '待联系', contacted: '已联系', promised: '承诺还款',
    resolved: '已结案', failed: '失败'
};
const STATUS_COLORS = {
    pending: '#f59e0b', contacted: '#3b82f6', promised: '#10b981',
    resolved: '#6b7280', failed: '#ef4444'
};

// ---- Utility ----
function fmt(n) { return Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function now() { return new Date().toISOString(); }
function uid() { return 'cs_' + Date.now() + '_' + Math.random().toString(36).substr(2,6); }
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ---- Data Layer ----
function loadCases() {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch(e) { return []; }
}
function saveCases(cases) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cases)); } catch(e) { alert('存储空间不足，请导出数据后清理'); }
}
function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch(e) { return ''; }
}
function saveToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch(e) {}
}

// ---- Case CRUD ----
function addCase(e) {
    e.preventDefault();
    const name = document.getElementById('caseName').value.trim();
    const amount = parseFloat(document.getElementById('caseAmount').value);
    const product = document.getElementById('caseProduct').value;
    const overdue = parseInt(document.getElementById('caseOverdue').value);

    if (!name || isNaN(amount) || amount <= 0) { alert('请填写有效信息'); return; }

    const cs = loadCases();
    cs.unshift({
        id: uid(), name, amount, product, overdueDays: overdue,
        status: 'pending', plan: null, notes: '',
        createdAt: now(), updatedAt: now()
    });
    saveCases(cs);
    closeAddCase();
    document.getElementById('caseName').value = '';
    document.getElementById('caseAmount').value = '';
    document.getElementById('caseOverdue').value = '';
    document.getElementById('syncBadge').className = 'backup-status unsynced';
    document.getElementById('syncBadge').textContent = '⚠ 未同步';
    renderAll();
}

function updateCaseStatus(id, newStatus) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;
    c.status = newStatus;
    c.updatedAt = now();
    saveCases(cs);
    document.getElementById('syncBadge').className = 'backup-status unsynced';
    document.getElementById('syncBadge').textContent = '⚠ 未同步';
    renderAll();
    showCaseDetail(id);
}

function updateCasePlan(id, planData) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;
    c.plan = planData;
    c.updatedAt = now();
    saveCases(cs);
}

function updateCaseNotes(id, notes) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;
    c.notes = notes;
    c.updatedAt = now();
    saveCases(cs);
    document.getElementById('syncBadge').className = 'backup-status unsynced';
    document.getElementById('syncBadge').textContent = '⚠ 未同步';
}

function deleteCase(id) {
    if (!confirm('确定删除这个案件？')) return;
    let cs = loadCases();
    cs = cs.filter(x => x.id !== id);
    saveCases(cs);
    document.getElementById('syncBadge').className = 'backup-status unsynced';
    document.getElementById('syncBadge').textContent = '⚠ 未同步';
    closeDetail();
    renderAll();
}

// ---- IRR Calculator (from original app) ----
function irrNpv(values, dates, rate) {
    const r = rate + 1;
    let result = values[0];
    for (let i = 1; i < values.length; i++) {
        result += values[i] / Math.pow(r, (dates[i] - dates[0]) / DAYS_PER_YEAR);
    }
    return result;
}
function irrNpvDeriv(values, dates, rate) {
    const r = rate + 1;
    let result = 0;
    for (let i = 1; i < values.length; i++) {
        const frac = (dates[i] - dates[0]) / DAYS_PER_YEAR;
        result -= frac * values[i] / Math.pow(r, frac + 1);
    }
    return result;
}
function calculateIRR(values, dates, guess) {
    guess = guess || 0.1;
    const epsMax = 1e-10;
    let resultRate = guess;
    for (let iter = 0; iter < 200; iter++) {
        const v = irrNpv(values, dates, resultRate);
        const d = irrNpvDeriv(values, dates, resultRate);
        if (Math.abs(d) < 1e-15) break;
        const newRate = resultRate - v / d;
        if (Math.abs(newRate - resultRate) <= epsMax && Math.abs(v) <= epsMax) { resultRate = newRate; break; }
        resultRate = newRate;
    }
    return resultRate;
}
function buildInstallmentCashflow(principal, monthlyPayment, loanTerm) {
    const values = [-principal];
    const dates = [0];
    for (let i = 1; i <= loanTerm; i++) { values.push(monthlyPayment); dates.push(Math.round(i * DAYS_PER_MONTH)); }
    return { values, dates };
}

// ---- Calculation Engine ----
function calculateMediation(principal, overdueDays, productType, installmentMonths, reductionRate) {
    installmentMonths = installmentMonths || 6;
    reductionRate = reductionRate || 0;

    const isLicensed = productType !== '其他';
    const lpr = DEFAULT_LPR;
    const maxRate = isLicensed ? LICENSED_RATE_CAP : lpr * 4;

    // Total owed with interest
    const totalInterest = principal * (maxRate / 100) * (overdueDays / DAYS_PER_YEAR);
    const totalOwed = principal + totalInterest;

    // Penalty
    const penaltyRate = DEFAULT_DAILY_RATE / 100;
    const penalty = principal * penaltyRate * overdueDays;

    // Reduction
    const excessInterest = totalInterest * (reductionRate / 100);
    const reduced = totalOwed - excessInterest;
    const finalOwed = reduced + penalty;

    // Installment
    const monthlyPayment = finalOwed / installmentMonths;

    // IRR
    const { values, dates } = buildInstallmentCashflow(principal, monthlyPayment, installmentMonths);
    const irr = calculateIRR(values, dates) * 100;

    return {
        principal,
        overdueDays,
        productType,
        isLicensed,
        maxRate,
        totalInterest: totalInterest,
        totalOwed,
        penalty,
        excessInterest,
        reduced,
        finalOwed,
        installmentMonths,
        monthlyPayment,
        irr,
        totalRepayment: monthlyPayment * installmentMonths,
        reductionRate
    };
}

// ---- Rendering ----
let currentFilter = 'all';

function renderAll() {
    renderDashboard();
    renderCaseList();
}

function renderDashboard() {
    const cs = loadCases();
    const counts = { pending:0, contacted:0, promised:0, resolved:0, failed:0 };
    cs.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });
    document.getElementById('statPending').textContent = counts.pending;
    document.getElementById('statContacted').textContent = counts.contacted;
    document.getElementById('statPromised').textContent = counts.promised;
    document.getElementById('statResolved').textContent = counts.resolved;
}

function renderCaseList() {
    const cs = loadCases();
    const filtered = currentFilter === 'all' ? cs : cs.filter(c => c.status === currentFilter);
    const container = document.getElementById('caseList');

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-500 py-12"><div class="text-4xl mb-3">📭</div><p>暂无案件</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(c => `
        <div class="case-item flex items-center justify-between" onclick="showCaseDetail('${c.id}')">
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <span class="status-dot status-${c.status}"></span>
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(c.name)} <span class="text-slate-400 font-normal">${fmt(c.amount)}元</span></div>
                    <div class="text-xs text-slate-500 mt-0.5">
                        <span class="tag ${c.product==='马上金融'?'tag-ms':c.product==='安逸花'?'tag-ayh':'tag-other'}">${escapeHtml(c.product)}</span>
                        <span class="ml-2">逾期${c.overdueDays}天</span>
                        ${c.plan ? '<span class="ml-2 text-orange-400">已计算方案</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="text-xs flex-shrink-0 ml-2" style="color:${STATUS_COLORS[c.status]}">${STATUS_LABELS[c.status]} ›</div>
        </div>
    `).join('');
}

function showCaseDetail(id) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;

    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');

    const statusOptions = STATUSES.map(s => `
        <option value="${s}" ${c.status===s?'selected':''}>${STATUS_LABELS[s]}</option>
    `).join('');

    const planHtml = c.plan ? `
        <div class="mt-4 p-3 rounded-lg" style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15)">
            <div class="text-sm font-medium text-emerald-400 mb-2">📊 已保存计算方案</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="text-slate-400">月供:</div><div class="text-right">${fmt(c.plan.monthlyPayment)}元 x ${c.plan.installmentMonths}期</div>
                <div class="text-slate-400">年化IRR:</div><div class="text-right ${c.plan.irr>36?'text-red-400':'text-emerald-400'}">${c.plan.irr.toFixed(2)}%</div>
                <div class="text-slate-400">减免:</div><div class="text-right">${fmt(c.plan.excessInterest)}元 (${c.plan.reductionRate}%)</div>
                <div class="text-slate-400">总还款:</div><div class="text-right font-bold">${fmt(c.plan.totalRepayment)}元</div>
            </div>
        </div>
    ` : '';

    content.innerHTML = `
        <!-- Tab Bar -->
        <div class="flex border-b border-slate-700 mb-4">
            <button class="tab-btn active" onclick="switchTab(event,'tabInfo')">信息</button>
            <button class="tab-btn" onclick="switchTab(event,'tabCalc')">计算器</button>
            <button class="tab-btn" onclick="switchTab(event,'tabScript')">话术</button>
        </div>

        <!-- Info Tab -->
        <div id="tabInfo" class="tab-content">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="text-lg font-bold">${escapeHtml(c.name)}</h3>
                    <p class="text-sm text-slate-400">${fmt(c.amount)}元 · ${escapeHtml(c.product)} · 逾期${c.overdueDays}天</p>
                </div>
                <button onclick="deleteCase('${c.id}')" class="text-red-400 text-sm">🗑 删除</button>
            </div>

            <div class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-400 mb-1">案件状态</label>
                    <select onchange="updateCaseStatus('${c.id}',this.value)" class="input-field text-sm" style="color:${STATUS_COLORS[c.status]}">
                        ${statusOptions}
                    </select>
                </div>

                <div>
                    <label class="block text-xs text-slate-400 mb-1">备注</label>
                    <textarea id="notesInput" class="input-field text-sm" rows="3" placeholder="记录沟通要点...">${escapeHtml(c.notes||'')}</textarea>
                    <button onclick="saveNotes('${c.id}')" class="btn-secondary text-xs mt-2 w-full">保存备注</button>
                </div>

                ${planHtml}

                <div class="text-xs text-slate-500 mt-3">
                    创建: ${new Date(c.createdAt).toLocaleString('zh-CN')}<br>
                    更新: ${new Date(c.updatedAt).toLocaleString('zh-CN')}
                </div>
            </div>
        </div>

        <!-- Calculator Tab -->
        <div id="tabCalc" class="tab-content hidden">
            <p class="text-sm text-slate-400 mb-4">基于案件数据自动填充，可手动调整</p>
            <form onsubmit="calcAndSave(event,'${c.id}')" class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-400 mb-1">借款本金</label>
                    <input type="number" id="calcPrincipal" class="input-field text-sm" value="${c.amount}" step="0.01">
                </div>
                <div>
                    <label class="block text-xs text-slate-400 mb-1">逾期天数</label>
                    <input type="number" id="calcOverdue" class="input-field text-sm" value="${c.overdueDays}">
                </div>
                <div>
                    <label class="block text-xs text-slate-400 mb-1">分期期数</label>
                    <input type="number" id="calcMonths" class="input-field text-sm" value="6" min="1" max="60">
                </div>
                <div>
                    <label class="block text-xs text-slate-400 mb-1">减免比例(%)</label>
                    <input type="number" id="calcReduction" class="input-field text-sm" value="0" min="0" max="100">
                </div>
                <button type="submit" class="btn-primary w-full text-sm">计算并保存</button>
            </form>
            <div id="calcResult" class="mt-3"></div>
        </div>

        <!-- Script Tab -->
        <div id="tabScript" class="tab-content hidden">
            <p class="text-sm text-slate-400 mb-4">根据案件自动生成合规话术</p>
            <button onclick="generateScript('${c.id}')" class="btn-primary w-full text-sm mb-3">生成话术</button>
            <div id="scriptOutput" class="p-3 rounded-lg text-sm" style="background:rgba(30,41,59,0.8);border:1px solid rgba(148,163,184,0.1);max-height:400px;overflow-y:auto;white-space:pre-wrap;"></div>
        </div>

        <!-- Close Button -->
        <button onclick="closeDetail()" class="btn-secondary w-full mt-4">关闭</button>
    `;

    modal.classList.add('show');
}

function switchTab(e, tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
}

function saveNotes(id) {
    const notes = document.getElementById('notesInput').value;
    updateCaseNotes(id, notes);
    showCaseDetail(id);
}

function calcAndSave(e, id) {
    e.preventDefault();
    const principal = parseFloat(document.getElementById('calcPrincipal').value);
    const overdue = parseInt(document.getElementById('calcOverdue').value);
    const months = parseInt(document.getElementById('calcMonths').value);
    const reduction = parseFloat(document.getElementById('calcReduction').value);

    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;

    const result = calculateMediation(principal, overdue, c.product, months, reduction);
    updateCasePlan(id, result);

    document.getElementById('calcResult').innerHTML = `
        <div class="p-3 rounded-lg" style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15)">
            <div class="text-sm font-medium text-emerald-400 mb-2">✅ 计算结果</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="text-slate-400">法定利率上限:</div><div class="text-right">${result.maxRate.toFixed(1)}%</div>
                <div class="text-slate-400">应付利息:</div><div class="text-right">${fmt(result.totalInterest)}元</div>
                <div class="text-slate-400">违约金:</div><div class="text-right">${fmt(result.penalty)}元</div>
                <div class="text-slate-400">减免金额:</div><div class="text-right text-emerald-400">-${fmt(result.excessInterest)}元</div>
                <div class="text-slate-400">应还总额:</div><div class="text-right font-bold">${fmt(result.finalOwed)}元</div>
                <div class="text-slate-400">分期月供:</div><div class="text-right font-bold text-lg">${fmt(result.monthlyPayment)}元 x ${result.installmentMonths}期</div>
                <div class="text-slate-400">年化IRR:</div><div class="text-right ${result.irr>36?'text-red-400':'text-emerald-400'}">${result.irr.toFixed(2)}%</div>
            </div>
        </div>
    `;
}

function generateScript(id) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;

    const isLicensed = c.product !== '其他';
    const plan = c.plan;

    let script = '';
    if (isLicensed) {
        script = `【合规话术 - 持牌消费金融】

客户称呼：${c.name}先生/女士

━━━━━ 开场白 ━━━━━
您好，我是马上消费金融的调解专员。关于您名下借款本金 ${fmt(c.amount)} 元的逾期情况，今天致电是想帮您协商一个可行的还款方案。

━━━━━ 债务说明 ━━━━━
您的借款本金为 ${fmt(c.amount)} 元，截至目前已逾期 ${c.overdueDays} 天。根据监管规定，持牌消费金融公司年化利率不得超过 ${LICENSED_RATE_CAP}%，我们严格遵守此标准。`;

        if (plan) {
            script += `

━━━━━ 还款方案 ━━━━━
我们为您制定了以下协商方案：
• 应还总额：${fmt(plan.finalOwed)} 元
• 其中减免利息：${fmt(plan.excessInterest)} 元
• 分期方案：${plan.installmentMonths} 期，每月 ${fmt(plan.monthlyPayment)} 元
• 年化利率（IRR）：${plan.irr.toFixed(2)}%

希望您能接受这个方案，我们可以在合规范围内尽可能帮助您减轻负担。`;
        } else {
            script += `\n\n建议先在计算器中为您核算具体方案，再进行协商沟通。`;
        }

        script += `

━━━━━ 法律提示 ━━━━━
• 本次通话全程录音，用于合规存档
• 根据《催收自律公约》及2026年新规，催收联系不得在22:00至次日8:00之间进行
• 我们不会使用威胁、恐吓、辱骂等不合规手段
• 如有疑问可拨打马上消费金融官方客服热线核实`;
    } else {
        script = `【合规话术 - 民间借贷】

客户称呼：${c.name}先生/女士

━━━━━ 开场白 ━━━━━
您好，我是债权方委托的调解专员，关于您名下借款 ${fmt(c.amount)} 元的逾期情况，今天希望能和您协商还款方案。

━━━━━ 债务说明 ━━━━━
您的借款本金为 ${fmt(c.amount)} 元，逾期 ${c.overdueDays} 天。根据最高院民间借贷司法解释，利率不得超过合同成立时一年期LPR的4倍（当前约${(DEFAULT_LPR*4).toFixed(1)}%）。`;

        if (plan) {
            script += `

━━━━━ 还款方案 ━━━━━
协商方案如下：
• 应还总额：${fmt(plan.finalOwed)} 元
• 减免金额：${fmt(plan.excessInterest)} 元
• 分期：${plan.installmentMonths} 期，每期 ${fmt(plan.monthlyPayment)} 元
• IRR：${plan.irr.toFixed(2)}%`;
        }
    }

    document.getElementById('scriptOutput').textContent = script;
}

// ---- Modal Controls ----
function openAddCase() { document.getElementById('addCaseModal').classList.add('show'); }
function closeAddCase() { document.getElementById('addCaseModal').classList.remove('show'); }
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }
function openSettings() {
    document.getElementById('githubToken').value = loadToken();
    document.getElementById('settingsModal').classList.add('show');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

// ---- Sync ----
async function syncNow() {
    const token = document.getElementById('githubToken').value.trim();
    if (!token) { alert('请先输入GitHub Token'); return; }
    saveToken(token);

    const badge = document.getElementById('syncBadge');
    badge.className = 'backup-status unsynced';
    badge.textContent = '⏳ 同步中...';

    try {
        const cs = loadCases();
        const dataJson = JSON.stringify(cs, null, 2);
        const content = btoa(unescape(encodeURIComponent(dataJson)));

        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

        // Check if data file exists
        let sha = null;
        try {
            const resp = await fetch(apiUrl, { headers });
            if (resp.ok) {
                const j = await resp.json();
                sha = j.sha;
                // Download remote data and merge
                const remoteContent = decodeURIComponent(escape(atob(j.content)));
                const remote = JSON.parse(remoteContent);
                // Merge: remote wins for same ID if newer
                const merged = mergeCases(cs, remote);
                saveCases(merged);
                const mergedJson = JSON.stringify(merged, null, 2);
                const mergedB64 = btoa(unescape(encodeURIComponent(mergedJson)));
                const putBody = { message: 'Sync cases', content: mergedB64, sha };
                const putResp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(putBody) });
                if (!putResp.ok) throw new Error('Upload failed');
            }
        } catch (e) {
            // File doesn't exist, create it
            const putBody = { message: 'Init cases data', content };
            const putResp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(putBody) });
            if (!putResp.ok) throw new Error('Create failed: ' + putResp.status);
        }

        badge.className = 'backup-status synced';
        badge.textContent = '✓ 已同步';
        renderAll();
    } catch (e) {
        badge.className = 'backup-status unsynced';
        badge.textContent = '✗ 同步失败';
        console.error(e);
        alert('同步失败: ' + e.message);
    }
}

function mergeCases(local, remote) {
    const map = {};
    local.forEach(c => map[c.id] = c);
    remote.forEach(c => {
        if (!map[c.id] || new Date(c.updatedAt) > new Date(map[c.id].updatedAt)) {
            map[c.id] = c;
        }
    });
    return Object.values(map).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function exportData() {
    const cs = loadCases();
    const json = JSON.stringify(cs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cases_backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importDataPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            if (!Array.isArray(data)) throw new Error('Invalid format');
            const cs = loadCases();
            const merged = mergeCases(cs, data);
            saveCases(merged);
            document.getElementById('syncBadge').className = 'backup-status unsynced';
            document.getElementById('syncBadge').textContent = '⚠ 未同步';
            renderAll();
            alert(`导入完成，共 ${merged.length} 个案件`);
        } catch(e) {
            alert('文件格式错误');
        }
    };
    input.click();
}

// ---- Filter ----
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('filterTabs').addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-tab')) {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderCaseList();
        }
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
            }
        });
    });

    // Check sync status on load
    const badge = document.getElementById('syncBadge');
    const token = loadToken();
    if (token) {
        badge.className = 'backup-status synced';
        badge.textContent = '✓ 已同步';
    } else {
        badge.className = 'backup-status unsynced';
        badge.textContent = '⚠ 未设置同步';
    }

    renderAll();
});
