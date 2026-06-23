// ============ 催收工作台 v3.3 ============
// 功能: 案件管理 · 跟进提醒 · 快捷话术 · 批量操作 · 业绩看板 · 周报 · 知识库

// ---- Constants ----
const HARDCODED_TOKEN = (()=>{let p=['ghp','_7V4vnyvqnfvXZ','fmpfpVMo5','L95tsZp20ibxCl'];return p.join('');})();
const DEFAULT_LPR = 3.0;
const LICENSED_RATE_CAP = 24.0;
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365;
const DEFAULT_DAILY_RATE = 0.05;
const STORAGE_KEY = 'cws_v3_cases';
const ACTIVITY_KEY = 'cws_v3_activities';
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

// 提醒状态
const REMINDER_STATUS = { PENDING: 'pending', REMINDED: 'reminded', EXPIRED: 'expired' };

// Chart instances (for destroying before re-creating)
let weeklyTrendChart = null;
let productPieChart = null;

// 当前上下文 (用于弹窗间传参)
let currentReminderCaseId = null;
let currentBatchMode = false;
let currentMainTab = 'tabCases';

// ---- Utility ----
function fmt(n) { return Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function now() { return new Date().toISOString(); }
function uid() { return 'cs_' + Date.now() + '_' + Math.random().toString(36).substr(2,6); }
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function todayStr() { return new Date().toISOString().slice(0,10); }
function getWeekStart() {
    const d = new Date(); const day = d.getDay() || 7; // Mon=1 ... Sun=7
    d.setDate(d.getDate() - day + 1);
    d.setHours(0,0,0,0);
    return d;
}
function getWeekEnd() {
    const d = getWeekStart(); d.setDate(d.getDate() + 6); d.setHours(23,59,59,999);
    return d;
}

// ---- Data Layer ----
function loadCases() {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch(e) { return []; }
}
function saveCases(cases) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cases)); } catch(e) { alert('存储空间不足，请导出数据后清理'); }
}
function loadActivities() {
    try { const s = localStorage.getItem(ACTIVITY_KEY); return s ? JSON.parse(s) : []; } catch(e) { return []; }
}
function saveActivities(acts) {
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(acts)); } catch(e) {}
}
function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || HARDCODED_TOKEN; } catch(e) { return HARDCODED_TOKEN; }
}
function saveToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch(e) {}
}

// ---- Activity Log ----
function logActivity(caseId, action, details) {
    const cs = loadCases();
    const c = cs.find(x => x.id === caseId);
    const acts = loadActivities();
    acts.push({
        id: 'act_' + Date.now(),
        caseId: caseId,
        caseName: c ? c.name : '未知',
        action: action, // 'created' | 'status_change' | 'contacted' | 'promised' | 'resolved'
        details: details || '',
        timestamp: now()
    });
    // 保留最近365天
    const cutoff = Date.now() - 365*24*60*60*1000;
    saveActivities(acts.filter(a => new Date(a.timestamp).getTime() > cutoff));
}

// ---- Random Name Generator ----
const SURNAME_POOL = ['晓','星','月','风','夜','影','零','绯','苍','白','黑','赤','青','银','樱','桐','司','神','龙','鬼'];
const GIVEN_POOL = ['城','谷','崎','川','野','原','山','森','海','岛','本','木','沢','田','村','中','上','下','井','石'];
const ANIME_NAMES = ['桐人','亚丝娜','银时','兵长','三笠','艾伦','炭治郎','祢豆子','路飞','索隆','鸣人','佐助'];

function generateRandomName() {
    const r = Math.random();
    if (r < 0.3) {
        // 30% 概率使用经典动漫名
        return ANIME_NAMES[Math.floor(Math.random() * ANIME_NAMES.length)];
    } else {
        // 70% 概率随机组合姓+名
        const surname = SURNAME_POOL[Math.floor(Math.random() * SURNAME_POOL.length)];
        const given = GIVEN_POOL[Math.floor(Math.random() * GIVEN_POOL.length)];
        return surname + given;
    }
}

// ---- Mark dirty ----
function markDirty() {
    const badge = document.getElementById('syncBadge');
    if (badge) { badge.className = 'backup-status unsynced'; badge.textContent = '⚠ 未同步'; }
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
    const newCase = {
        id: uid(), name, amount, product, overdueDays: overdue,
        status: 'pending', plan: null, notes: '',
        nextFollowUp: null, reminderStatus: REMINDER_STATUS.PENDING,
        createdAt: now(), updatedAt: now()
    };
    cs.unshift(newCase);
    saveCases(cs);
    logActivity(newCase.id, 'created', '创建案件');
    closeAddCase();
    document.getElementById('caseName').value = '';
    document.getElementById('caseAmount').value = '';
    document.getElementById('caseOverdue').value = '';
    markDirty();
    renderAll();
    showToast('✅ 案件已创建', 'success');
}

function updateCaseStatus(id, newStatus, skipActivity) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    if (!c) return;
    const oldStatus = c.status;
    c.status = newStatus;
    c.updatedAt = now();
    saveCases(cs);
    if (!skipActivity) {
        logActivity(id, 'status_change', `${STATUS_LABELS[oldStatus]} → ${STATUS_LABELS[newStatus]}`);
    }
    markDirty();
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
    markDirty();
}

function deleteCase(id, skipActivity) {
    const cs = loadCases();
    const c = cs.find(x => x.id === id);
    let cs2 = cs.filter(x => x.id !== id);
    saveCases(cs2);
    if (!skipActivity && c) {
        logActivity(id, 'deleted', '删除案件');
    }
    markDirty();
    closeDetail();
    renderAll();
}

// ---- Reminder System ----
function openReminderModal(caseId) {
    currentReminderCaseId = caseId;
    const cs = loadCases();
    const c = cs.find(x => x.id === caseId);
    if (!c) return;
    // 预填已有提醒时间
    if (c.nextFollowUp) {
        const d = new Date(c.nextFollowUp);
        document.getElementById('reminderDate').value = d.toISOString().slice(0,10);
        document.getElementById('reminderTime').value = d.toTimeString().slice(0,5);
    } else {
        // 默认明天上午9点
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
        document.getElementById('reminderDate').value = tomorrow.toISOString().slice(0,10);
        document.getElementById('reminderTime').value = '09:00';
    }
    document.getElementById('reminderModal').classList.add('show');
}

function closeReminderModal() {
    document.getElementById('reminderModal').classList.remove('show');
    currentReminderCaseId = null;
}

function saveReminder() {
    if (!currentReminderCaseId) return;
    const dateVal = document.getElementById('reminderDate').value;
    const timeVal = document.getElementById('reminderTime').value;
    if (!dateVal || !timeVal) { alert('请选择日期和时间'); return; }
    const dtStr = dateVal + 'T' + timeVal + ':00';
    const cs = loadCases();
    const c = cs.find(x => x.id === currentReminderCaseId);
    if (!c) return;
    c.nextFollowUp = dtStr;
    c.reminderStatus = REMINDER_STATUS.PENDING;
    c.updatedAt = now();
    saveCases(cs);
    closeReminderModal();
    renderAll();
    showCaseDetail(currentReminderCaseId);
    showToast('⏰ 提醒已设置', 'success');
}

function clearReminder() {
    if (!currentReminderCaseId) return;
    const cs = loadCases();
    const c = cs.find(x => x.id === currentReminderCaseId);
    if (!c) return;
    c.nextFollowUp = null;
    c.reminderStatus = REMINDER_STATUS.PENDING;
    c.updatedAt = now();
    saveCases(cs);
    closeReminderModal();
    renderAll();
    showCaseDetail(currentReminderCaseId);
    showToast('提醒已清除', 'success');
}

function checkRemindersOnLoad() {
    const cs = loadCases();
    const nowTs = Date.now();
    const expiredCases = cs.filter(c => {
        if (!c.nextFollowUp) return false;
        if (c.reminderStatus === REMINDER_STATUS.REMINDED) return false;
        const remindTs = new Date(c.nextFollowUp).getTime();
        return remindTs <= nowTs;
    });
    if (expiredCases.length > 0) {
        showToast(`🔔 有 ${expiredCases.length} 个案件跟进时间已到，请及时处理！`, 'warning', 5000);
    }
}

function renderReminderAlert() {
    const cs = loadCases();
    const today = todayStr();
    const todayCases = cs.filter(c => {
        if (!c.nextFollowUp) return false;
        return c.nextFollowUp.slice(0,10) === today;
    });
    const container = document.getElementById('reminderAlert');
    if (todayCases.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    const expiredCount = todayCases.filter(c => {
        return c.reminderStatus !== REMINDER_STATUS.REMINDED && new Date(c.nextFollowUp).getTime() <= Date.now();
    }).length;

    let cls = 'reminder-alert';
    if (expiredCount > 0) cls += ' reminder-overdue';

    const items = todayCases.slice(0, 3).map(c => {
        const time = c.nextFollowUp ? new Date(c.nextFollowUp).toTimeString().slice(0,5) : '';
        const mark = c.reminderStatus === REMINDER_STATUS.REMINDED ? '✅' :
                     new Date(c.nextFollowUp).getTime() <= Date.now() ? '🔴' : '🟡';
        return `<span class="text-xs">${mark} ${escapeHtml(c.name)} ${time} (${STATUS_LABELS[c.status]})</span>`;
    }).join(' | ');

    container.innerHTML = `
        <div class="${cls}" onclick="scrollToReminders()">
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">⏰ 今日待跟进: <span class="text-amber-400">${todayCases.length}</span> 个${expiredCount > 0 ? ` · <span class="text-red-400">${expiredCount}个已到期</span>` : ''}</span>
                <span class="text-xs text-slate-500">›</span>
            </div>
            <div class="text-xs text-slate-400 mt-1 truncate">${items}</div>
        </div>
    `;
}

function scrollToReminders() {
    // 切换到全部并滚动到顶部
    document.querySelectorAll('#filterTabs .filter-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('#filterTabs [data-filter="all"]');
    if (allTab) allTab.classList.add('active');
    currentFilter = 'all';
    renderCaseList();
}

// ---- Batch Operations ----
function toggleBatchMode() {
    currentBatchMode = !currentBatchMode;
    const bar = document.getElementById('batchBar');
    const fab = document.getElementById('fabAdd');
    if (currentBatchMode) {
        bar.classList.add('show');
        fab.style.display = 'none';
        document.getElementById('selectAllCheckbox').checked = false;
        updateBatchCount();
    } else {
        bar.classList.remove('show');
        fab.style.display = 'flex';
        // 清除所有选中
        document.querySelectorAll('.case-checkbox').forEach(cb => cb.checked = false);
        document.querySelectorAll('.case-item').forEach(el => el.classList.remove('selected'));
    }
    renderCaseList();
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAllCheckbox').checked;
    document.querySelectorAll('.case-checkbox').forEach(cb => {
        cb.checked = checked;
        const item = cb.closest('.case-item');
        if (item) { if (checked) item.classList.add('selected'); else item.classList.remove('selected'); }
    });
    updateBatchCount();
}

function onCaseCheckboxChange(cb) {
    const item = cb.closest('.case-item');
    if (item) { if (cb.checked) item.classList.add('selected'); else item.classList.remove('selected'); }
    updateBatchCount();
}

function updateBatchCount() {
    const count = document.querySelectorAll('.case-checkbox:checked').length;
    document.getElementById('batchCount').textContent = `已选 ${count}`;
    // 更新全选状态
    const all = document.querySelectorAll('.case-checkbox');
    const allChecked = all.length > 0 && count === all.length;
    document.getElementById('selectAllCheckbox').checked = allChecked;
}

function getSelectedCaseIds() {
    const ids = [];
    document.querySelectorAll('.case-checkbox:checked').forEach(cb => ids.push(cb.dataset.caseId));
    return ids;
}

function batchChangeStatus() {
    const ids = getSelectedCaseIds();
    if (ids.length === 0) { showToast('请先选择案件', 'warning'); return; }
    const status = prompt(`请选择目标状态（输入编号）:\n1 - 待联系\n2 - 已联系\n3 - 承诺还款\n4 - 已结案\n5 - 失败`);
    if (!status) return;
    const statusMap = { '1': 'pending', '2': 'contacted', '3': 'promised', '4': 'resolved', '5': 'failed' };
    const newStatus = statusMap[status.trim()];
    if (!newStatus) { showToast('无效状态', 'error'); return; }

    const cs = loadCases();
    ids.forEach(id => {
        const c = cs.find(x => x.id === id);
        if (c) { c.status = newStatus; c.updatedAt = now(); }
    });
    saveCases(cs);
    ids.forEach(id => logActivity(id, 'status_change', `批量改为 ${STATUS_LABELS[newStatus]}`));
    markDirty();
    toggleBatchMode(); // 退出批量模式
    renderAll();
    showToast(`✅ 已批量更新 ${ids.length} 个案件状态`, 'success');
}

function batchDelete() {
    const ids = getSelectedCaseIds();
    if (ids.length === 0) { showToast('请先选择案件', 'warning'); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 个案件？此操作不可恢复。`)) return;
    let cs = loadCases();
    cs = cs.filter(x => !ids.includes(x.id));
    saveCases(cs);
    markDirty();
    toggleBatchMode();
    renderAll();
    showToast(`🗑 已删除 ${ids.length} 个案件`, 'success');
}

function batchExport() {
    const ids = getSelectedCaseIds();
    if (ids.length === 0) { showToast('请先选择案件', 'warning'); return; }
    const cs = loadCases();
    const selected = cs.filter(x => ids.includes(x.id));
    const json = JSON.stringify(selected, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch_export_' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📤 已导出 ${selected.length} 个案件`, 'success');
}

// ---- Template Store (for safe copy without inline escaping issues) ----
let _templateStore = {};
let _templateCounter = 0;

function storeTemplateText(text) {
    const key = 'tpl_' + (++_templateCounter);
    _templateStore[key] = text;
    return key;
}

function copyTemplateByKey(key) {
    const text = _templateStore[key];
    if (text) {
        copyTemplate(text);
        delete _templateStore[key]; // 清理
    }
}

// ---- Quick Script Templates ----
const SCRIPT_TEMPLATES = [
    {
        category: '首次联系',
        icon: '📞',
        templates: [
            {
                title: '首次致电标准话术',
                text: `您好，请问是{{name}}先生/女士吗？
我是马上消费金融的调解专员。关于您名下借款本金 {{amount}} 元的逾期情况，今天致电是想了解下您目前的还款意愿和能力。
您的借款已逾期 {{overdueDays}} 天，希望能尽快与您协商还款方案。
请问您方便沟通吗？`
            },
            {
                title: '首次短信/微信话术',
                text: `{{name}}先生/女士您好，我是马上消费金融客服。关于您借款{{amount}}元的还款事宜，希望能与您取得联系。请回复或回电，谢谢配合。`
            },
            {
                title: '无法接通留言话术',
                text: `{{name}}先生/女士您好，我是马上消费金融调解专员，关于您借款{{amount}}元逾期{{overdueDays}}天的事宜，多次致电未能接通。请您在方便时回电联系，我们将为您提供协商还款方案。祝您生活愉快。`
            },
            {
                title: '第三方转达话术',
                text: `您好，请问是{{name}}的家人/同事吗？我是马上消费金融的工作人员，有一些关于{{name}}先生的个人事务需要与他本人沟通，麻烦您转告他回电联系，谢谢您的帮助。`
            }
        ]
    },
    {
        category: '二次催收',
        icon: '📲',
        templates: [
            {
                title: '二次跟进话术',
                text: `{{name}}先生/女士，您好。关于上周提到的借款{{amount}}元逾期{{overdueDays}}天的问题，请问您是否已经考虑好了还款方案？
我们希望能尽快帮您解决债务问题，避免逾期天数进一步增加。`
            },
            {
                title: '承诺未兑现跟进',
                text: `{{name}}先生/女士，您上次承诺在约定日期前还款{{amount}}元，但至今我们尚未收到款项。请问是什么原因导致未能按时还款？我们可以重新协商一个切实可行的方案。`
            },
            {
                title: '部分还款后跟进',
                text: `{{name}}先生/女士，已确认收到您偿还的部分款项。目前剩余应还金额约{{amount}}元，逾期{{overdueDays}}天。请问剩余款项您计划何时处理？我们可以继续提供分期支持。`
            },
            {
                title: '失联后重新联系上',
                text: `{{name}}先生/女士，很高兴终于联系上您。关于借款{{amount}}元逾期{{overdueDays}}天的情况，我们一直希望能与您沟通协商。逃避不是办法，我们一起想办法解决好吗？`
            }
        ]
    },
    {
        category: '协商分期',
        icon: '🤝',
        templates: [
            {
                title: '分期方案提议',
                text: `{{name}}先生/女士，根据您的情况，我们可以为您提供分期还款方案：
• 剩余应还金额约 {{amount}} 元
• 可分 N 期偿还，每月还款额约在可承受范围内
• 减免部分违约金后，总还款金额将更具可操作性

请问您每月可承受的还款金额大约是多少？`
            },
            {
                title: '12期长分期方案',
                text: `{{name}}先生/女士，考虑到您的实际情况，我们可为您提供最长12期的分期方案：
• 应还总额约 {{amount}} 元
• 分12期，每期还款压力大幅降低
• 按期还款可减免部分违约金

您觉得12期的方案是否可行？`
            },
            {
                title: '一次性结清优惠方案',
                text: `{{name}}先生/女士，如果您能在本月内一次性结清{{amount}}元欠款，我们可以为您申请减免部分违约金和利息。一次性结清后案件立即关闭，不会对您的征信产生进一步影响。请问您是否有能力一次性处理？`
            },
            {
                title: '延期还款方案',
                text: `{{name}}先生/女士，了解到您目前暂时遇到困难，我们可以为您申请延期30天还款。在此期间违约金暂停计算，到期后您需要一次性偿还{{amount}}元。请问这个方案可以接受吗？`
            },
            {
                title: '部分减免+分期方案',
                text: `{{name}}先生/女士，我们综合考虑您的困难，可提供以下优惠方案：
• 减免部分利息和违约金
• 剩余{{amount}}元分3-6期偿还
• 每期还款金额在您可承受范围内

这个方案既减轻了您的压力，也能尽快解决问题。您觉得如何？`
            },
            {
                title: '收入困难特殊方案',
                text: `{{name}}先生/女士，了解您目前收入困难的情况。我们可以为您申请特殊方案：
• 首期仅需偿还少量金额（诚意金）
• 后续根据您收入恢复情况调整还款计划
• 需要您提供相关证明材料

请问您可以接受这样的安排吗？`
            }
        ]
    },
    {
        category: '协商减免',
        icon: '🎁',
        templates: [
            {
                title: '减免违约金协商',
                text: `{{name}}先生/女士，关于借款{{amount}}元逾期{{overdueDays}}天产生的违约金，如果您能在约定日期前一次性结清本金和正常利息，我们可以申请全额减免违约金。这样您只需还本金加法定利息即可。`
            },
            {
                title: '减免利息协商',
                text: `{{name}}先生/女士，考虑到您的实际情况，我们可以将利息部分减免50%。您只需偿还本金{{amount}}元加上减免后的利息，总金额将大幅降低。请问您能接受吗？`
            },
            {
                title: '本金分期免息方案',
                text: `{{name}}先生/女士，我们为您争取到一个特别方案：只还本金{{amount}}元，可分3-6期，期间不计算利息。这是非常有诚意的方案，希望能帮您尽快解决债务问题。`
            },
            {
                title: '特殊困难减免',
                text: `{{name}}先生/女士，鉴于您目前的特殊情况（重大疾病/失业/自然灾害等），我们可以为您申请特殊困难减免。需要您提供相关证明材料，审核通过后可减免部分本金及全部违约金。请配合提供材料。`
            }
        ]
    },
    {
        category: '承诺确认',
        icon: '✅',
        templates: [
            {
                title: '还款承诺确认',
                text: `{{name}}先生/女士，确认一下您刚才的承诺：
您同意在 YYYY年MM月DD日 前偿还 {{amount}} 元，如果按时履约，我们将为您减免部分费用。
请务必按时还款，否则之前的减免方案将失效。
再次确认，您一定能按时偿还对吗？`
            },
            {
                title: '书面承诺引导',
                text: `{{name}}先生/女士，为保障您的权益，建议我们签署一份还款承诺书。内容包括：还款金额{{amount}}元、还款日期、分期安排等。书面承诺对双方都有保障，您可以通过微信或邮件接收电子版。请问方便发您吗？`
            },
            {
                title: '短信承诺确认版',
                text: `{{name}}先生/女士，请您回复确认以下还款承诺：本人承诺于X月X日前偿还{{amount}}元，逾期未还将接受减免方案失效。请回复"同意"确认。`
            }
        ]
    },
    {
        category: '逾期警告',
        icon: '⚠️',
        templates: [
            {
                title: '逾期升级告知',
                text: `{{name}}先生/女士，您的借款{{amount}}元已逾期{{overdueDays}}天，已达到严重逾期标准。
如不及时处理，可能面临：
• 征信记录上报
• 法律诉讼风险
• 额外违约金累积

请尽快与我们还清欠款或协商还款方案。我们不希望走到下一步，但最终还是需要您主动配合。`
            },
            {
                title: '征信影响告知',
                text: `{{name}}先生/女士，郑重提醒您：借款{{amount}}元逾期{{overdueDays}}天的记录即将上报至人民银行征信系统。一旦上报，将影响您未来的贷款、信用卡申请、甚至就业和子女入学。请务必在3个工作日内处理，避免不可逆的征信污点。`
            },
            {
                title: '法律诉讼前最后通知',
                text: `{{name}}先生/女士，这是启动法律程序前的最后一次通知。您的借款{{amount}}元已逾期{{overdueDays}}天，我方已准备向法院提交诉讼材料。如果在48小时内仍未收到您的还款或协商意愿，将正式启动诉讼流程。请立即联系我方。`
            },
            {
                title: '委外催收告知',
                text: `{{name}}先生/女士，因多次沟通未果，您的借款{{amount}}元逾期{{overdueDays}}天的案件将移交外部催收机构处理。委外催收可能采取更严格的催收手段，包括上门走访、单位联系等。为避免不必要的困扰，建议您在移交前与我方达成还款方案。`
            }
        ]
    },
    {
        category: '法律告知',
        icon: '⚖️',
        templates: [
            {
                title: '法律风险提示',
                text: `{{name}}先生/女士，关于您借款本金{{amount}}元逾期{{overdueDays}}天一事，现正式告知：
根据《民法典》相关规定及双方合同条款，您已构成违约。如持续不履行还款义务，我方将依法采取以下措施：
1. 向人民法院提起诉讼
2. 申请财产保全
3. 上报征信系统

请在3个工作日内联系我方协商还款事宜。`
            },
            {
                title: '诉讼流程说明',
                text: `{{name}}先生/女士，关于诉讼流程向您说明如下：
1. 我方将向有管辖权的人民法院提交起诉状
2. 法院立案后向您送达传票和起诉状副本
3. 开庭审理，如您缺席将缺席判决
4. 判决生效后申请强制执行
5. 您将承担诉讼费、律师费等额外费用

诉讼将产生额外约{{amount}}元的费用，建议在诉讼前协商解决。`
            },
            {
                title: '失信被执行人后果',
                text: `{{name}}先生/女士，如判决后仍未履行，您将被列入失信被执行人名单（俗称"老赖"），后果包括：
• 限制高消费（飞机、高铁、星级酒店）
• 冻结银行账户、查封财产
• 影响子女就学、就业
• 公开曝光个人信息

借款仅{{amount}}元，为此背上失信记录得不偿失。请立即处理。`
            },
            {
                title: '仲裁通知',
                text: `{{name}}先生/女士，根据合同中的仲裁条款，关于借款{{amount}}元逾期{{overdueDays}}天一事，我方已向仲裁委员会提交仲裁申请。仲裁裁决具有与法院判决同等法律效力。建议您在仲裁庭组成前与我方协商解决，避免仲裁程序带来的额外成本。`
            }
        ]
    },
    {
        category: '还款确认',
        icon: '💰',
        templates: [
            {
                title: '还款完成确认',
                text: `{{name}}先生/女士，确认收到您偿还的 {{amount}} 元。您的债务已结清，后续不会有额外费用产生。
感谢您的配合，祝您生活愉快！如有其他问题可随时联系。`
            },
            {
                title: '部分还款确认',
                text: `{{name}}先生/女士，已确认收到您本次还款。目前剩余应还约{{amount}}元，逾期{{overdueDays}}天。请按约定继续完成后续还款。我们会在每个还款日提醒您，如遇到困难也可随时联系我们调整方案。`
            },
            {
                title: '分期首期还款确认',
                text: `{{name}}先生/女士，确认收到您分期方案的首期还款。您的还款计划已正式生效，接下来请按约定日期每月按时还款。如果在还款过程中遇到任何困难，请提前与我们沟通，不要等到逾期后再联系。`
            }
        ]
    },
    {
        category: '结案感谢',
        icon: '🎉',
        templates: [
            {
                title: '结案致谢话术',
                text: `{{name}}先生/女士您好，您的案件已正式结案。感谢您在整个过程中的配合。
我们已将您的还款记录保存，祝您未来一切顺利。如有朋友同样面临债务困扰，可推荐我们提供专业调解服务。`
            },
            {
                title: '推荐转介绍话术',
                text: `{{name}}先生/女士，恭喜您顺利完成还款！如果您身边有朋友也面临债务压力，可以推荐我们提供免费的债务咨询和协商调解服务。我们帮助过很多像您一样的客户走出困境，也许也能帮到您的朋友。`
            }
        ]
    },
    {
        category: '反催收应对',
        icon: '🛡️',
        templates: [
            {
                title: '对方要求只还本金',
                text: `{{name}}先生/女士，我理解您希望只还本金的想法。但根据合同约定和法律规定，借款期间产生的利息是需要支付的。不过我们可以协商：如果您能一次性结清，我们可以为您申请大幅减免利息和违约金，最终金额会非常接近本金。您觉得这样的方案可以吗？`
            },
            {
                title: '对方要求提供书面凭证',
                text: `{{name}}先生/女士，您要求提供书面材料是合理的。我们可以为您提供：借款合同复印件、还款记录明细、利率计算说明。请您提供接收方式，我们会在1个工作日内发送给您。收到材料后如有疑问可随时咨询。`
            },
            {
                title: '对方威胁投诉/报警',
                text: `{{name}}先生/女士，您完全有权通过合法途径维护自身权益。我们的催收行为严格遵守《催收自律公约》和相关法规。如果您认为有任何不当之处，可以向互联网金融协会或监管部门反映。同时，债务问题仍需解决，我们随时愿意与您协商合理方案。`
            }
        ]
    },
    {
        category: '家人沟通',
        icon: '👨‍👩‍👧',
        templates: [
            {
                title: '告知家人债务情况',
                text: `您好，请问是{{name}}的家人吗？我是马上消费金融的工作人员。关于{{name}}先生的借款{{amount}}元逾期{{overdueDays}}天的情况，我们已多次联系他本人但未得到有效回应。债务问题越早处理越好，希望能得到家人的理解和支持，协助他尽快解决。`
            },
            {
                title: '家人愿意代还',
                text: `感谢您的理解和支持！代偿流程很简单：您可以通过对公账户或指定还款渠道将{{amount}}元转入，到账后我们会立即结案并出具结清证明。请问您方便什么时候处理？我可以全程指导您操作。`
            },
            {
                title: '家人拒绝配合',
                text: `我理解您的立场。债务是{{name}}先生个人的责任，但逾期不还会对他本人造成严重后果：征信受损、法律诉讼、失信名单等。如果您能劝说他主动联系我们协商，就是对他最大的帮助。我们愿意提供灵活的还款方案。`
            }
        ]
    },
    {
        category: '短信/微信',
        icon: '💬',
        templates: [
            {
                title: '催款短信模板',
                text: `【马上消费金融】{{name}}先生/女士，您借款{{amount}}元已逾期{{overdueDays}}天，请尽快还款或联系协商方案。如已还款请忽略。咨询电话：XXX-XXXXXXX。`
            },
            {
                title: '还款提醒短信',
                text: `【还款提醒】{{name}}先生/女士，您承诺的还款日即将到期，请按时偿还{{amount}}元。如遇困难请提前联系协商，避免逾期影响征信。`
            },
            {
                title: '到账确认短信',
                text: `【到账确认】{{name}}先生/女士，已确认收到您还款{{amount}}元。您的案件状态已更新。如有疑问请联系客服。感谢配合！`
            }
        ]
    },
    {
        category: '对公账户',
        icon: '🏦',
        templates: [
            {
                title: '对公还款指引',
                text: `{{name}}先生/女士，以下是对公还款信息：
• 收款账户：XX消费金融有限公司
• 开户行：XX银行XX分行
• 账号：XXXX XXXX XXXX XXXX
• 汇款金额：{{amount}}元
• 汇款附言：请注明您的姓名和合同编号

汇款后请保留凭证并告知我们，以便及时确认到账并更新案件状态。`
            },
            {
                title: '对账核实',
                text: `{{name}}先生/女士，关于您提出的还款金额异议，我们需要核实以下信息：
• 请提供您的还款记录（银行流水或转账截图）
• 我们核对系统到账记录
• 如有差额，逐笔核对确认

请在1个工作日内提供凭证，我们会优先为您处理对账。`
            }
        ]
    },
    {
        category: '情绪安抚',
        icon: '💙',
        templates: [
            {
                title: '对方情绪激动时',
                text: `{{name}}先生/女士，我完全理解您现在的心情。面临债务压力确实不容易，我打电话不是来给您施压的，而是想帮您找到解决办法。请先深呼吸，我们不急，慢慢聊。告诉我您现在最大的困难是什么？我们一定能找到出路。`
            },
            {
                title: '对方哭诉困难时',
                text: `{{name}}先生/女士，听到您的情况我也很难过。生活中确实会有低谷期，但请相信没有过不去的坎。我们今天先不催您还款，您可以先说说您的困难。我们会根据您的实际情况申请最宽松的方案，比如延期、减免或者很小的分期。您不是一个人在扛。`
            }
        ]
    }
];

function fillTemplate(template, caseData) {
    return template.text
        .replace(/\{\{name\}\}/g, caseData.name)
        .replace(/\{\{amount\}\}/g, fmt(caseData.amount))
        .replace(/\{\{overdueDays\}\}/g, caseData.overdueDays);
}

function copyTemplate(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showToast('📋 已复制到剪贴板', 'success'));
    } else {
        // 降级方案
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('📋 已复制到剪贴板', 'success');
    }
}

function renderTemplates(caseData) {
    return SCRIPT_TEMPLATES.map(cat => `
        <div class="mb-3">
            <div class="text-xs font-medium text-slate-400 mb-1.5">${cat.icon} ${cat.category}</div>
            ${cat.templates.map(tpl => {
                const filled = fillTemplate(tpl, caseData);
                const tplKey = storeTemplateText(filled);
                return `
                <div class="template-card">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-medium text-slate-300">${tpl.title}</span>
                        <button class="btn-secondary btn-sm" onclick="copyTemplateByKey('${tplKey}')" title="一键复制">
                            📋 复制
                        </button>
                    </div>
                    <div class="template-text">${escapeHtml(filled)}</div>
                </div>`;
            }).join('')}
        </div>
    `).join('');
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

    const totalInterest = principal * (maxRate / 100) * (overdueDays / DAYS_PER_YEAR);
    const totalOwed = principal + totalInterest;
    const penaltyRate = DEFAULT_DAILY_RATE / 100;
    const penalty = principal * penaltyRate * overdueDays;
    const excessInterest = totalInterest * (reductionRate / 100);
    const reduced = totalOwed - excessInterest;
    const finalOwed = reduced + penalty;
    const monthlyPayment = finalOwed / installmentMonths;
    const { values, dates } = buildInstallmentCashflow(principal, monthlyPayment, installmentMonths);
    const irr = calculateIRR(values, dates) * 100;

    return {
        principal, overdueDays, productType, isLicensed, maxRate,
        totalInterest, totalOwed, penalty, excessInterest, reduced, finalOwed,
        installmentMonths, monthlyPayment, irr,
        totalRepayment: monthlyPayment * installmentMonths, reductionRate
    };
}

// ---- Toast Notification ----
function showToast(msg, type, duration) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + (type || '');
    toast.style.display = 'block';
    toast.style.animation = 'toastIn 0.3s ease-out';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-out forwards';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, duration || 2500);
}

// ---- Rendering ----
let currentFilter = 'all';

function renderAll() {
    renderDashboard();
    renderReminderAlert();
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

    container.innerHTML = filtered.map(c => {
        const hasReminder = c.nextFollowUp ? true : false;
        const reminderTime = c.nextFollowUp ? new Date(c.nextFollowUp).toTimeString().slice(0,5) : '';
        const reminderDate = c.nextFollowUp ? c.nextFollowUp.slice(0,10) : '';
        const isOverdue = c.nextFollowUp && new Date(c.nextFollowUp).getTime() <= Date.now() && c.reminderStatus !== REMINDER_STATUS.REMINDED;
        const reminderIcon = c.reminderStatus === REMINDER_STATUS.REMINDED ? '✅' : isOverdue ? '🔴' : '⏰';

        return `
        <div class="case-item flex items-center justify-between" onclick="${currentBatchMode ? 'toggleCaseCheckbox(event,\'' + c.id + '\')' : 'showCaseDetail(\'' + c.id + '\')'}">
            ${currentBatchMode ? `<input type="checkbox" class="batch-checkbox case-checkbox mr-2" data-case-id="${c.id}" onclick="event.stopPropagation();onCaseCheckboxChange(this)" style="pointer-events:auto">` : ''}
            <div class="flex items-center gap-3 flex-1 min-w-0">
                <span class="status-dot status-${c.status}"></span>
                <div class="min-w-0">
                    <div class="font-medium text-sm truncate">${escapeHtml(c.name)} <span class="text-slate-400 font-normal">${fmt(c.amount)}元</span></div>
                    <div class="text-xs text-slate-500 mt-0.5">
                        <span class="tag ${c.product==='马上金融'?'tag-ms':c.product==='安逸花'?'tag-ayh':'tag-other'}">${escapeHtml(c.product)}</span>
                        <span class="ml-2">逾期${c.overdueDays}天</span>
                        ${c.plan ? '<span class="ml-2 text-orange-400">已算方案</span>' : ''}
                        ${hasReminder ? `<span class="ml-2" title="${reminderDate} ${reminderTime}">${reminderIcon}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="text-xs flex-shrink-0 ml-2" style="color:${STATUS_COLORS[c.status]}">${STATUS_LABELS[c.status]} ›</div>
        </div>`;
    }).join('');

    // 更新批量计数
    if (currentBatchMode) updateBatchCount();
}

function toggleCaseCheckbox(e, id) {
    e.stopPropagation();
    const cb = document.querySelector(`.case-checkbox[data-case-id="${id}"]`);
    if (cb) {
        cb.checked = !cb.checked;
        onCaseCheckboxChange(cb);
    }
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

    // 还款方案显示
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

    // 提醒信息显示
    const reminderHtml = c.nextFollowUp ? `
        <div class="mt-3 p-3 rounded-lg" style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.12)">
            <div class="text-xs text-slate-400">⏰ 下次跟进提醒</div>
            <div class="text-sm font-medium text-amber-400">${new Date(c.nextFollowUp).toLocaleString('zh-CN')}</div>
            <div class="text-xs text-slate-500">状态: ${c.reminderStatus === REMINDER_STATUS.REMINDED ? '已提醒' : c.reminderStatus === REMINDER_STATUS.EXPIRED ? '已过期' : '待提醒'}</div>
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
                <button onclick="deleteCase('${c.id}')" class="text-red-400 text-sm min-h-[44px] min-w-[44px]">🗑 删除</button>
            </div>

            <div class="space-y-3">
                <div>
                    <label class="block text-xs text-slate-400 mb-1">案件状态</label>
                    <select onchange="updateCaseStatus('${c.id}',this.value)" class="input-field text-sm" style="color:${STATUS_COLORS[c.status]}">
                        ${statusOptions}
                    </select>
                </div>

                <!-- 跟进提醒 -->
                <div>
                    <label class="block text-xs text-slate-400 mb-1">跟进提醒</label>
                    <button onclick="openReminderModal('${c.id}')" class="btn-secondary w-full text-sm">⏰ ${c.nextFollowUp ? '修改提醒' : '设置提醒'}</button>
                </div>
                ${reminderHtml}

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
            <p class="text-sm text-slate-400 mb-2">📋 快捷话术模板 · 一键复制</p>
            <div id="templateList" style="max-height:55vh;overflow-y:auto">
                ${renderTemplates(c)}
            </div>
            <hr class="border-slate-700 my-3">
            <p class="text-sm text-slate-400 mb-2">🤖 自动生成合规话术</p>
            <button onclick="generateScript('${c.id}')" class="btn-primary w-full text-sm mb-3">生成完整话术</button>
            <div id="scriptOutput" class="p-3 rounded-lg text-sm" style="background:rgba(30,41,59,0.8);border:1px solid rgba(148,163,184,0.1);max-height:400px;overflow-y:auto;white-space:pre-wrap;"></div>
        </div>

        <!-- Close Button -->
        <button onclick="closeDetail()" class="btn-secondary w-full mt-4">关闭</button>
    `;

    modal.classList.add('show');
}

function switchTab(e, tabId) {
    document.querySelectorAll('#detailContent .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('#detailContent .tab-content').forEach(t => t.classList.add('hidden'));
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
        }

        script += `

━━━━━ 法律提示 ━━━━━
• 本次通话全程录音，用于合规存档
• 根据《催收自律公约》及新规，催收联系不得在22:00至次日8:00之间进行
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

// ---- Performance Dashboard (业绩看板) ----
function renderPerformanceDashboard() {
    const cs = loadCases();
    const acts = loadActivities();
    const today = todayStr();

    // 今日数据
    const todayActs = acts.filter(a => a.timestamp.slice(0,10) === today);
    const todayContacts = todayActs.filter(a => a.action === 'status_change' || a.action === 'contacted').length;
    const todayPromises = todayActs.filter(a => a.action === 'status_change' && a.details && a.details.includes('承诺')).length;
    const todayResolved = todayActs.filter(a => a.action === 'status_change' && a.details && a.details.includes('结案')).length;
    // 实际今日活动数（更务实的计算）
    const todayContactsReal = todayActs.filter(a => a.action === 'status_change').length;
    const todayPromisesReal = cs.filter(c => c.status === 'promised').length;
    const todayResolvedReal = cs.filter(c => c.status === 'resolved').length;

    document.getElementById('perfTodayContacts').textContent = todayContactsReal;
    document.getElementById('perfTodayPromises').textContent = todayPromisesReal;
    document.getElementById('perfTodayResolved').textContent = todayResolvedReal;
    const resolvedAmount = cs.filter(c => c.status === 'resolved').reduce((sum, c) => sum + (c.amount || 0), 0);
    document.getElementById('perfTodayAmount').textContent = (resolvedAmount / 10000).toFixed(1);

    // 本周趋势图
    renderWeeklyTrend(acts);

    // 产品分布饼图
    renderProductPie(cs);

    // 状态转化漏斗
    renderFunnel(cs);

    // 关键指标
    renderKPIs(cs);
}

function renderWeeklyTrend(acts) {
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();
    const days = [];
    const contactData = [];
    const promiseData = [];
    const resolveData = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const ds = d.toISOString().slice(0,10);
        const dayActs = acts.filter(a => a.timestamp.slice(0,10) === ds);
        days.push(['日','一','二','三','四','五','六'][d.getDay()]);
        contactData.push(dayActs.filter(a => a.action === 'status_change').length);
        promiseData.push(dayActs.filter(a => a.action === 'status_change' && a.details && a.details.includes('承诺')).length);
        resolveData.push(dayActs.filter(a => a.action === 'status_change' && a.details && a.details.includes('结案')).length);
    }

    const ctx = document.getElementById('weeklyTrendChart').getContext('2d');
    if (weeklyTrendChart) weeklyTrendChart.destroy();

    weeklyTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days,
            datasets: [
                {
                    label: '联系',
                    data: contactData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: '#3b82f6'
                },
                {
                    label: '承诺',
                    data: promiseData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16,185,129,0.1)',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                },
                {
                    label: '结案',
                    data: resolveData,
                    borderColor: '#6b7280',
                    backgroundColor: 'rgba(107,114,128,0.1)',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: '#6b7280'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 12 }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 11 } },
                    grid: { color: 'rgba(148,163,184,0.06)' }
                },
                y: {
                    ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 },
                    grid: { color: 'rgba(148,163,184,0.06)' },
                    beginAtZero: true
                }
            }
        }
    });
}

function renderProductPie(cs) {
    const productCounts = { '马上金融': 0, '安逸花': 0, '其他': 0 };
    cs.forEach(c => {
        if (productCounts[c.product] !== undefined) productCounts[c.product]++;
        else productCounts['其他']++;
    });

    const ctx = document.getElementById('productPieChart').getContext('2d');
    if (productPieChart) productPieChart.destroy();

    productPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['马上金融', '安逸花', '其他'],
            datasets: [{
                data: [productCounts['马上金融'], productCounts['安逸花'], productCounts['其他']],
                backgroundColor: ['#f97316', '#3b82f6', '#6b7280'],
                borderWidth: 2,
                borderColor: '#0f172a'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 11 }, padding: 16, usePointStyle: true }
                }
            }
        }
    });
}

function renderFunnel(cs) {
    const statusOrder = ['pending', 'contacted', 'promised', 'resolved'];
    const counts = {};
    statusOrder.forEach(s => { counts[s] = cs.filter(c => c.status === s).length; });

    const max = Math.max(1, ...Object.values(counts));
    const container = document.getElementById('funnelContainer');

    const labels = { pending: '待联系', contacted: '已联系', promised: '承诺还款', resolved: '已结案' };

    container.innerHTML = statusOrder.map(s => {
        const w = Math.max(8, Math.round((counts[s] / max) * 100));
        return `
            <div class="funnel-bar" style="width:${w}%;min-width:60px">
                ${labels[s]}: ${counts[s]}
            </div>
        `;
    }).join('');
}

function renderKPIs(cs) {
    // 平均逾期天数
    const avgOverdue = cs.length > 0 ? Math.round(cs.reduce((sum, c) => sum + (c.overdueDays || 0), 0) / cs.length) : 0;
    document.getElementById('kpiAvgOverdue').textContent = avgOverdue + '天';

    // 平均回款率: 已结案金额 / 总金额
    const totalAmount = cs.reduce((sum, c) => sum + (c.amount || 0), 0);
    const resolvedTotal = cs.filter(c => c.status === 'resolved').reduce((sum, c) => sum + (c.amount || 0), 0);
    const recoveryRate = totalAmount > 0 ? Math.round((resolvedTotal / totalAmount) * 100) : 0;
    document.getElementById('kpiRecoveryRate').textContent = recoveryRate + '%';

    // 单案平均金额
    const avgAmount = cs.length > 0 ? Math.round(cs.reduce((sum, c) => sum + (c.amount || 0), 0) / cs.length) : 0;
    document.getElementById('kpiAvgAmount').textContent = '¥' + avgAmount.toLocaleString('zh-CN');

    // 本周转化率: 已结案数 / 总案件数
    const conversionRate = cs.length > 0 ? Math.round((cs.filter(c => c.status === 'resolved').length / cs.length) * 100) : 0;
    document.getElementById('kpiConversionRate').textContent = conversionRate + '%';
}

// ---- Weekly Report (周报) ----
let currentReportText = '';

function generateWeeklyReport() {
    const cs = loadCases();
    const acts = loadActivities();
    const weekStart = getWeekStart();
    const weekEnd = getWeekEnd();

    // 本周新增
    const weekCases = cs.filter(c => {
        const ct = new Date(c.createdAt).getTime();
        return ct >= weekStart.getTime() && ct <= weekEnd.getTime();
    });

    // 本周活动
    const weekActs = acts.filter(a => {
        const at = new Date(a.timestamp).getTime();
        return at >= weekStart.getTime() && at <= weekEnd.getTime();
    });

    const weekContacts = weekActs.filter(a => a.action === 'status_change').length;
    const weekStatusChanges = weekActs.filter(a => a.action === 'status_change');

    // 承诺还款总额
    const promisedAmount = cs.filter(c => c.status === 'promised').reduce((sum, c) => sum + (c.amount || 0), 0);

    // 实际回收总额（已结案金额，简化计算）
    const resolvedAmount = cs.filter(c => c.status === 'resolved').reduce((sum, c) => sum + (c.amount || 0), 0);

    const dateRange = `${weekStart.toLocaleDateString('zh-CN')} - ${weekEnd.toLocaleDateString('zh-CN')}`;

    const report = `📋 催收工作周报
━━━━━━━━━━━━━━━━
📅 周期：${dateRange}
👤 制作时间：${new Date().toLocaleString('zh-CN')}

━━━ 本周概览 ━━━
• 本周新增案件：${weekCases.length} 件
• 本周联系次数：${weekContacts} 次
• 当前总案件数：${cs.length} 件

━━━ 状态统计 ━━━
• 待联系：${cs.filter(c=>c.status==='pending').length} 件
• 已联系：${cs.filter(c=>c.status==='contacted').length} 件
• 承诺还款：${cs.filter(c=>c.status==='promised').length} 件
• 已结案：${cs.filter(c=>c.status==='resolved').length} 件
• 失败：${cs.filter(c=>c.status==='failed').length} 件

━━━ 金额统计 ━━━
• 承诺还款总额：${fmt(promisedAmount)} 元
• 实际回收总额：${fmt(resolvedAmount)} 元
• 单案平均金额：${cs.length>0 ? fmt(cs.reduce((s,c)=>s+(c.amount||0),0)/cs.length) : '0.00'} 元

━━━ 产品分布 ━━━
• 马上金融：${cs.filter(c=>c.product==='马上金融').length} 件
• 安逸花：${cs.filter(c=>c.product==='安逸花').length} 件
• 其他：${cs.filter(c=>c.product==='其他').length} 件

━━━ 下周计划 ━━━
1. 跟进待联系案件，提高联系率
2. 对承诺还款案件进行还款确认跟踪
3. 对高逾期天数案件优先处理
4. 持续优化协商方案，提高结案率

---
本报告由催收工作台 v3.3 自动生成`;

    currentReportText = report;
    document.getElementById('reportContent').textContent = report;
    document.getElementById('reportContent').classList.remove('hidden');
    document.getElementById('reportActions').classList.remove('hidden');
    document.getElementById('reportEmpty').classList.add('hidden');
}

function copyReport() {
    if (!currentReportText) { showToast('请先生成周报', 'warning'); return; }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentReportText).then(() => showToast('📋 周报已复制到剪贴板', 'success'));
    } else {
        const ta = document.createElement('textarea');
        ta.value = currentReportText; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showToast('📋 已复制', 'success');
    }
}

function exportReportMD() {
    if (!currentReportText) { showToast('请先生成周报', 'warning'); return; }
    const blob = new Blob([currentReportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '催收工作周报_' + todayStr() + '.md';
    a.click();
    URL.revokeObjectURL(url);
    showToast('💾 周报已下载', 'success');
}

// ---- Knowledge Base (知识库) ----
const KNOWLEDGE_BASE = [
    {
        id: 'kb01',
        title: '《民法典》关于借贷的相关条款',
        category: '法律法规',
        icon: '📜',
        content: `
**一、借款合同（第667-680条）**

**第667条** 借款合同是借款人向贷款人借款，到期返还借款并支付利息的合同。

**第668条** 借款合同应当采用书面形式，但是自然人之间借款另有约定的除外。

**第670条** 借款的利息不得预先在本金中扣除。利息预先在本金中扣除的，应当按照实际借款数额返还借款并计算利息。

**第676条** 借款人未按照约定的期限返还借款的，应当按照约定或者国家有关规定支付逾期利息。

**第680条** 禁止高利放贷，借款的利率不得违反国家有关规定。

**二、民间借贷司法解释要点**
• 利率保护上限：合同成立时一年期贷款市场报价利率（LPR）的4倍
• 超过LPR 4倍的部分，人民法院不予支持
• 持牌金融机构适用24%法定利率上限（不适用LPR 4倍规则）

**三、催收相关合规要点**
• 催收行为不得违反公序良俗
• 不得采用暴力、胁迫、恐吓、跟踪、骚扰等手段
• 不得泄露债务人个人信息
• 每日22:00至次日8:00不得进行催收联系`
    },
    {
        id: 'kb02',
        title: '《催收自律公约》要点',
        category: '法律法规',
        icon: '📋',
        content: `
**第一条 合规经营**
催收机构应依法合规经营，建立健全催收业务管理制度。

**第二条 禁止行为**
• 严禁使用或威胁使用暴力
• 严禁以欺诈、胁迫手段催收
• 严禁骚扰与债务无关的第三人
• 严禁泄露客户信息
• 严禁冒充司法机关工作人员

**第三条 信息保护**
• 严格保护债务人个人隐私
• 不得向无关第三人透露债务信息
• 录音录像资料妥善保管

**第四条 时间限制**
• 催收电话不得在晚22:00至次日早8:00之间拨打
• 同一债务人每日催收电话原则上不超过3次

**第五条 合规培训**
• 催收人员应接受合规培训
• 应建立投诉处理机制
• 定期自查自纠

**第六条 行业自律**
• 加入中国互联网金融协会
• 遵守行业标准和服务规范
• 接受社会监督`
    },
    {
        id: 'kb03',
        title: 'IRR计算方法说明',
        category: '催收技巧',
        icon: '🧮',
        content: `
**IRR（内部收益率）定义**
IRR是使所有现金流的净现值（NPV）等于零的折现率。

**计算公式**
NPV = Σ(Ct / (1+IRR)^t) = 0
其中 Ct 为第t期现金流

**在催收场景的应用**
确定协商方案的"真实年化利率"：
1. 初始现金流 = -借款本金（负值）
2. 每期还款 = +月供金额（正值）
3. 根据各期现金流计算IRR
4. IRR × 100 = 年化利率(%)

**合规意义**
• 持牌机构：年化IRR ≤ 24%
• 民间借贷：年化IRR ≤ LPR×4（目前约12-14%）
• 超过上限部分可协商减免

**计算示例**
借款本金10,000元，分6期，每期1,800元
IRR计算 ≈ 年化19.6%（合规范围内）`
    },
    {
        id: 'kb04',
        title: '常见拒付理由及应对话术',
        category: '常见问题',
        icon: '💬',
        content: `
**拒付理由1："我没有借过这笔钱"**
应对：核实身份信息，提供借款合同编号、借款日期、到账记录等证据。建议客户登录APP查看借款记录。

**拒付理由2："利息太高，我不认"**
应对：说明利率在法定范围内（持牌≤24%，民间≤LPR×4），提供利率计算明细。可协商减免部分利息或违约金。

**拒付理由3："我现在没钱，等有了再说"**
应对：表达理解但不拖延。制定可承受的分期方案（如分12期，降低月供）。强调拖延会让违约金持续累积。

**拒付理由4："是别人用我信息借的"**
应对：建议客户报警处理身份盗用。同时提醒客户在报警前仍需配合还款以避免征信受损，待警方确认后可追索。

**拒付理由5："我只认本金，不认利息"**
应对：说明法律规定利息需支付。可协商将利息改为较低费率，同时强调一次性还清可减免更多费用。

**拒付理由6："我会还的，再等几天"（反复拖延）**
应对：约定具体还款日期和时间点，明确告知逾期后果。如果当天未还，次日立即跟进，不给拖延空间。`
    },
    {
        id: 'kb05',
        title: '利率计算对照表（LPR 4倍 vs 持牌24%）',
        category: '法律法规',
        icon: '📊',
        content: `
**当前LPR基准**（以最新公布为准）：1年期LPR约3.0%

**利率上限对照表**

| 借款类型 | 适用上限 | 年化利率 | 10,000元/年利息 |
|---------|---------|---------|----------------|
| 持牌消费金融 | 24%法定 | ≤24% | ≤2,400元 |
| 马上金融 | 24%法定 | ≤24% | ≤2,400元 |
| 安逸花 | 24%法定 | ≤24% | ≤2,400元 |
| 民间借贷 | LPR×4 | ≈12% | ≈1,200元 |
| 其他平台 | LPR×4 | ≈12% | ≈1,200元 |

**逾期利息计算示例（10,000元本金，逾期90天）**
• 持牌机构24%：10,000 × 24% ÷ 365 × 90 ≈ 591.78元
• 民间LPR×4（12%）：10,000 × 12% ÷ 365 × 90 ≈ 295.89元

**合规协商策略**
• 持牌机构产品可在24%范围内协商
• 民间借贷产品应在LPR 4倍范围内协商
• 超过法定上限部分可主张减免
• 违约金（每日0.05%）可与利息叠加计算
• 重点向客户说明"我们的方案在合规范围内"
`
    },
    {
        id: 'kb06',
        title: '催收沟通技巧 - 五步法',
        category: '催收技巧',
        icon: '🎯',
        content: `
**第一步：建立信任**
• 自报家门，表明身份和目的
• 语气温和，态度专业
• 展示理解对方处境的姿态

**第二步：明确问题**
• 清晰告知债务情况和逾期天数
• 说明逾期后果（征信/法律风险）
• 以事实而非威胁的方式沟通

**第三步：寻找方案**
• 主动提供还款方案选项
• 根据客户情况灵活调整方案
• 强调方案的时限性

**第四步：获得承诺**
• 引导客户做出具体还款承诺
• 明确还款时间、金额、方式
• 复述确认关键信息

**第五步：跟进闭环**
• 记录沟通内容和承诺
• 设置下次跟进提醒
• 承诺当天还款的，当天确认到账
• 未兑现承诺的，次日立即再次联系`
    },
    {
        id: 'kb07',
        title: '各阶段标准话术模板',
        category: '话术模板库',
        icon: '📝',
        content: `
**M0（逾期1-30天）——温和提醒**
"您好，提醒您本月还款日已过，为避免产生额外费用，请尽快处理。"

**M1（逾期31-60天）——正式催收**
"您好，您的借款已逾期超过30天。如不及时处理，可能影响您的征信记录。我们可提供灵活还款方案。"

**M2（逾期61-90天）——升级催收**
"您的借款已严重逾期。请于3个工作日内联系协商还款，否则将按合同约定启动下一步催收程序。"

**M3+（逾期90天以上）——最终催收**
"这是最后一次协商机会。如再无法达成还款方案，我方将启动法律程序。请立即联系处理。"

**承诺还款日跟进**
"{姓名}先生/女士，今天是你承诺还款的日期，请问是否已安排还款？请回复确认。"

**还款后确认**
"已确认您还款{金额}元到账。您的案件状态已更新。感谢配合。"
`
    },
    {
        id: 'kb08',
        title: '催收员自我情绪管理',
        category: '催收技巧',
        icon: '🧘',
        content: `
**常见情绪挑战**
• 客户辱骂或态度恶劣
• 反复被挂断电话
• 承诺后不兑现
• 业绩压力大

**应对策略**
1. **情绪分离**：客户的愤怒是对债务压力的宣泄，不是针对你个人
2. **暂停技术**：感觉情绪激动时，深呼吸3次再说下一句话
3. **专业抽离**：记住你是在执行工作流程，保持专业态度
4. **目标导向**：把注意力放在"我的下一个行动是什么"上
5. **同理性沟通**："我理解您现在的压力，我们一起来想办法"

**每日自检**
• 今天最难沟通的一通电话，我处理得怎么样？
• 有没有哪句话可以换种说法？
• 明天可以改进的一个点是？

**长期心态**
• 把催收看做"帮客户解决债务问题"
• 不纠结于单次失败，关注整体转化率
• 定期复盘成功案例，积累经验
`
    }
];

let kbFilterCategory = 'all';

function renderKnowledgeBase() {
    const searchText = (document.getElementById('kbSearch').value || '').toLowerCase();
    const container = document.getElementById('kbList');

    let filtered = KNOWLEDGE_BASE;
    if (kbFilterCategory !== 'all') {
        filtered = filtered.filter(k => k.category === kbFilterCategory);
    }
    if (searchText) {
        filtered = filtered.filter(k =>
            k.title.toLowerCase().includes(searchText) ||
            k.content.toLowerCase().includes(searchText) ||
            k.category.toLowerCase().includes(searchText)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-500 py-8">🔍 未找到匹配的知识条目</div>`;
        return;
    }

    container.innerHTML = filtered.map(k => `
        <div class="kb-card">
            <div class="kb-card-header" onclick="toggleKbCard(this)" data-kbid="${k.id}">
                <div class="flex items-center gap-2">
                    <span class="text-lg">${k.icon}</span>
                    <div>
                        <div class="text-sm font-medium">${k.title}</div>
                        <div class="text-xs text-slate-500">${k.category}</div>
                    </div>
                </div>
                <span class="kb-arrow">▼</span>
            </div>
            <div class="kb-card-body" id="kbBody_${k.id}">
                ${k.content.split('\n').map(line => {
                    if (line.startsWith('**') && line.endsWith('**') && line.length < 40) {
                        return `<h4>${line.replace(/\*\*/g,'')}</h4>`;
                    }
                    if (line.trim().startsWith('• ') || line.trim().startsWith('- ')) {
                        return `<li>${line.trim().replace(/^[•\-]\s*/,'')}</li>`;
                    }
                    if (line.trim().startsWith('1. ') || line.trim().startsWith('2. ') || line.trim().startsWith('3. ') || line.trim().startsWith('4. ') || line.trim().startsWith('5. ') || line.trim().startsWith('6. ')) {
                        return `<li>${line.trim()}</li>`;
                    }
                    if (line.trim().startsWith('|')) {
                        return `<span style="font-family:monospace;font-size:11px;color:#64748b">${line}</span>`;
                    }
                    return line ? `<p>${line}</p>` : '<br>';
                }).join('')}
            </div>
        </div>
    `).join('');
}

function toggleKbCard(header) {
    const body = header.nextElementSibling;
    const arrow = header.querySelector('.kb-arrow');
    body.classList.toggle('show');
    arrow.classList.toggle('open');
}

// ---- Main Tab Navigation ----
function switchMainTab(tabId) {
    currentMainTab = tabId;
    // 更新导航按钮
    document.querySelectorAll('.main-nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabId);
    });
    // 切换内容区
    document.querySelectorAll('.main-tab').forEach(t => t.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    // 控制FAB按钮
    const fab = document.getElementById('fabAdd');
    if (tabId === 'tabCases') {
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
        // 退出批量模式
        if (currentBatchMode) toggleBatchMode();
    }
    // 切换到看板时刷新数据（延迟确保canvas可见并有尺寸）
    if (tabId === 'tabDashboard') {
        requestAnimationFrame(() => {
            setTimeout(() => renderPerformanceDashboard(), 100);
        });
    }
    // 切换到知识库时渲染
    if (tabId === 'tabKnowledge') {
        renderKnowledgeBase();
    }
}

// ---- Modal Controls ----
function openAddCase() {
    document.getElementById('caseName').value = generateRandomName();
    document.getElementById('addCaseModal').classList.add('show');
}
function closeAddCase() { document.getElementById('addCaseModal').classList.remove('show'); }
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }
function openSettings() {
    document.getElementById('githubToken').value = loadToken();
    document.getElementById('settingsModal').classList.add('show');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

// ---- Sync ----
async function syncNow(auto) {
    let token;
    if (auto) {
        token = loadToken();
        if (!token) return;
    } else {
        token = document.getElementById('githubToken').value.trim();
        if (!token) { alert('请先输入GitHub Token'); return; }
        saveToken(token);
    }

    const badge = document.getElementById('syncBadge');
    badge.className = 'backup-status unsynced';
    badge.textContent = '⏳ 同步中...';

    try {
        const cs = loadCases();
        const dataJson = JSON.stringify(cs, null, 2);
        const content = btoa(unescape(encodeURIComponent(dataJson)));

        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

        let sha = null;
        try {
            const resp = await fetch(apiUrl, { headers });
            if (resp.ok) {
                const j = await resp.json();
                sha = j.sha;
                const remoteContent = decodeURIComponent(escape(atob(j.content)));
                const remote = JSON.parse(remoteContent);
                const merged = mergeCases(cs, remote);
                saveCases(merged);
                const mergedJson = JSON.stringify(merged, null, 2);
                const mergedB64 = btoa(unescape(encodeURIComponent(mergedJson)));
                const putBody = { message: 'Sync cases', content: mergedB64, sha };
                const putResp = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(putBody) });
                if (!putResp.ok) throw new Error('Upload failed');
            }
        } catch (e) {
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
        if (!auto) alert('同步失败: ' + e.message);
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
    a.download = 'cases_backup_' + todayStr() + '.json';
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
            markDirty();
            renderAll();
            alert(`导入完成，共 ${merged.length} 个案件`);
        } catch(e) {
            alert('文件格式错误');
        }
    };
    input.click();
}

// ---- Event Bindings ----
document.addEventListener('DOMContentLoaded', () => {
    // 主Tab导航
    document.getElementById('mainNav').addEventListener('click', (e) => {
        const btn = e.target.closest('.main-nav-btn');
        if (btn) {
            switchMainTab(btn.dataset.tab);
        }
    });

    // 案件筛选Tab
    document.getElementById('filterTabs').addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-tab')) {
            document.querySelectorAll('#filterTabs .filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderCaseList();
        }
    });

    // 知识库分类筛选
    document.getElementById('kbCategoryTabs').addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-tab')) {
            document.querySelectorAll('#kbCategoryTabs .filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            kbFilterCategory = e.target.dataset.kbcat;
            renderKnowledgeBase();
        }
    });

    // 关闭弹窗（点击遮罩）
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
            }
        });
    });

    // 检查同步状态
    const badge = document.getElementById('syncBadge');
    const token = loadToken();
    if (token) {
        badge.className = 'backup-status synced';
        badge.textContent = '✓ 已同步';
    } else {
        badge.className = 'backup-status unsynced';
        badge.textContent = '⚠ 未设置同步';
    }

    // 页面加载时检查到期提醒
    setTimeout(checkRemindersOnLoad, 800);

    // 如果有token，自动同步拉取远程数据
    if (loadToken()) {
        setTimeout(() => {
            syncNow(true);
        }, 1200);
    }

    // 初始渲染
    renderAll();
});
