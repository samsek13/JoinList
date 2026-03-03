// State
let token = localStorage.getItem("token");
let currentUser = null;
let qrTimer = null;
let qrKey = "";

// DOM Elements
const authPage = document.getElementById("auth-page");
const appPage = document.getElementById("app-page");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginError = document.getElementById("login-error");
const registerError = document.getElementById("register-error");
const usernameDisplay = document.getElementById("username-display");
const logoutButton = document.getElementById("logout-button");
const neteaseBoundStatus = document.getElementById("netease-bound-status");
const qrButton = document.getElementById("qr-button");
const qrImage = document.getElementById("qr-image");
const qrStatus = document.getElementById("qr-status");
const cookieInput = document.getElementById("cookie-input");
const bindCookieButton = document.getElementById("bind-cookie-button");
const clearCookieButton = document.getElementById("clear-cookie-button");
const cookieStatus = document.getElementById("cookie-status");
const mixForm = document.getElementById("mix-form");
const statusText = document.getElementById("status-text");
const progressText = document.getElementById("progress-text");
const resultLink = document.getElementById("result-link");
const distribution = document.getElementById("distribution");
const errorText = document.getElementById("error-text");
const tasksList = document.getElementById("tasks-list");
// >>> 修改开始：添加动态行相关元素引用
const sourceRowsContainer = document.getElementById("source-rows-container");
const addSourceBtn = document.getElementById("add-source-btn");
// >>> 修改结束

// Tab switching
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const targetForm = tab.dataset.tab === "login" ? loginForm : registerForm;
    const otherForm = tab.dataset.tab === "login" ? registerForm : loginForm;
    targetForm.classList.remove("hidden");
    otherForm.classList.add("hidden");
    loginError.textContent = "";
    registerError.textContent = "";
  });
});

// API helper
const api = async (endpoint, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(endpoint, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
};

// Check auth status
const checkAuth = async () => {
  if (!token) {
    showAuthPage();
    return;
  }
  const { ok, data } = await api("/api/auth/me");
  if (ok && data.user) {
    currentUser = data.user;
    showAppPage();
    updateNeteaseStatus(data.user.hasNeteaseCookie);
    loadTasks();
  } else {
    localStorage.removeItem("token");
    token = null;
    showAuthPage();
  }
};

// Show/hide pages
const showAuthPage = () => {
  authPage.classList.remove("hidden");
  appPage.classList.add("hidden");
};

const showAppPage = () => {
  authPage.classList.add("hidden");
  appPage.classList.remove("hidden");
  usernameDisplay.textContent = currentUser?.username || "";
  // >>> 修改开始：初始化源行
  initSourceRows();
  // >>> 修改结束
};

// Update Netease status display
const updateNeteaseStatus = (isBound) => {
  if (isBound) {
    neteaseBoundStatus.textContent = "已绑定";
    neteaseBoundStatus.classList.add("bound");
  } else {
    neteaseBoundStatus.textContent = "未绑定";
    neteaseBoundStatus.classList.remove("bound");
  }
};

// Login
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  const { ok, data } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  if (ok && data.ok) {
    token = data.token;
    localStorage.setItem("token", token);
    currentUser = data.user;
    showAppPage();
    checkAuth();
  } else {
    // 检查特定的错误类型
    if (data.error && data.error.includes("等待管理员批准")) {
      loginError.textContent = "账户正在等待管理员批准，请稍后再试";
    } else {
      loginError.textContent = data.error || "登录失败";
    }
  }
});

// Register
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerError.textContent = "";
  const username = document.getElementById("register-username").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;

  const { ok, data } = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email: email || undefined, password })
  });

  if (ok && data.ok) {
    // 注册成功，显示等待批准消息
    registerError.textContent = data.message || "注册申请已提交，请等待管理员批准后登录";
    registerError.style.color = "#4caf50";
    registerForm.reset();
    // 2秒后切换到登录页
    setTimeout(() => {
      registerError.style.color = "";
      registerError.textContent = "";
      document.querySelector('[data-tab="login"]').click();
    }, 2000);
  } else {
    registerError.textContent = data.error || "注册失败";
  }
});

// Logout
logoutButton.addEventListener("click", () => {
  localStorage.removeItem("token");
  token = null;
  currentUser = null;
  showAuthPage();
});

// QR Code
const stopQrTimer = () => {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
};

const startQrPolling = () => {
  stopQrTimer();
  qrTimer = setInterval(async () => {
    if (!qrKey) {
      stopQrTimer();
      return;
    }
    const { data } = await api(`/api/netease/qr/check?key=${encodeURIComponent(qrKey)}`);
    if (data.code === 803) {
      setQrStatus("绑定成功");
      stopQrTimer();
      qrImage.style.display = "none";
      updateNeteaseStatus(true);
      return;
    }
    if (data.code === 800) {
      setQrStatus("二维码已过期，请重新生成");
      stopQrTimer();
      return;
    }
    if (data.code === 802) {
      setQrStatus("已扫码，请在手机确认");
      return;
    }
    if (data.code === 801) {
      setQrStatus("等待扫码");
    }
  }, 2000);
};

const setQrStatus = (text) => {
  qrStatus.textContent = text;
};

qrButton.addEventListener("click", async () => {
  setQrStatus("正在生成二维码...");
  const { ok, data } = await api("/api/netease/qr");
  if (!ok) {
    setQrStatus("生成失败，请先登录");
    return;
  }
  qrKey = data.key || "";
  if (data.qrimg) {
    qrImage.src = data.qrimg;
    qrImage.style.display = "block";
  }
  setQrStatus("请使用网易云 App 扫码");
  startQrPolling();
});

// Bind cookie manually
bindCookieButton.addEventListener("click", async () => {
  const cookie = cookieInput.value.trim();
  if (!cookie) {
    cookieStatus.textContent = "请输入 Cookie";
    return;
  }
  cookieStatus.textContent = "绑定中...";
  const { ok, data } = await api("/api/netease/bind-cookie", {
    method: "POST",
    body: JSON.stringify({ cookie })
  });
  if (ok) {
    cookieStatus.textContent = "绑定成功";
    cookieInput.value = "";
    updateNeteaseStatus(true);
  } else {
    cookieStatus.textContent = data.error || "绑定失败";
  }
});

// Clear cookie
clearCookieButton.addEventListener("click", async () => {
  const { ok } = await api("/api/netease/clear-cookie", { method: "POST" });
  if (ok) {
    updateNeteaseStatus(false);
    cookieStatus.textContent = "已清除绑定";
  }
});

// Mix form
mixForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultLink.innerHTML = "";
  distribution.innerHTML = "";
  errorText.textContent = "";
  setStatus("提交中");

  // >>> 修改开始：从动态行收集数据
  const { sources, weights: weightStrings } = collectSourceData();

  // 验证至少 2 个歌单
  if (sources.length < 2) {
    errorText.textContent = "请至少填写 2 个歌单链接";
    setStatus("提交失败");
    return;
  }

  // 转换为原有格式
  const weightLines = weightStrings.map((w) => w.trim());
  // >>> 修改结束

  const weights = sources.map((_, index) => {
    const raw = weightLines[index] ?? "";
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });

  const hasWeights = weights.some((value) => value !== null);
  const minutes = Number(document.getElementById("duration").value || 0);
  const maxTotalDuration = Math.floor(minutes * 60);

  const payload = {
    sourceUrls: sources,
    maxTotalDuration
  };
  if (hasWeights) {
    payload.weights = weights;
  }

  const { ok, data } = await api("/api/mix", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!ok) {
    setStatus("提交失败");
    if (data.error === "netease_not_bound") {
      errorText.textContent = "请先绑定网易云账号";
    } else if (data.error === "weights_invalid") {
      errorText.textContent = "混合百分比无效，请检查总和是否为 100";
    } else if (data.error === "sourceUrls_invalid") {
      errorText.textContent = "歌单链接无效或存在重复";
    } else if (data.error === "unauthorized") {
      errorText.textContent = "请重新登录";
      showAuthPage();
    } else {
      errorText.textContent = data.error || "提交失败";
    }
    return;
  }

  setStatus("任务已创建");
  pollTask(data.taskId);
});

// Task polling
const setStatus = (text) => {
  statusText.textContent = text;
};

const setProgress = (progress) => {
  progressText.textContent = progress ? `进度：${progress}%` : "";
};

const renderDistribution = (items) => {
  distribution.innerHTML = "";
  if (!items || !items.length) return;
  items.forEach((item) => {
    const row = document.createElement("div");
    const minutes = (item.contributedTime / 60).toFixed(1);
    row.textContent = `${item.sourceName}：${minutes} 分钟，${item.songCount} 首`;
    distribution.appendChild(row);
  });
};

const pollTask = async (taskId) => {
  const { ok, data } = await api(`/api/task/${taskId}`);
  if (!ok) {
    setStatus("任务查询失败");
    return;
  }
  setStatus(data.status);
  setProgress(data.progress);
  renderDistribution(data.distribution);
  if (data.errorMessage) {
    errorText.textContent = data.errorMessage;
  }
  if (data.resultUrl) {
    resultLink.innerHTML = `<a href="${data.resultUrl}" target="_blank">打开新歌单</a>`;
  }
  if (data.status === "Completed" || data.status === "Failed") {
    loadTasks();
    return;
  }
  setTimeout(() => pollTask(taskId), 2000);
};

// Load tasks
const loadTasks = async () => {
  const { ok, data } = await api("/api/tasks");
  if (!ok || !data.tasks) return;

  tasksList.innerHTML = "";
  if (data.tasks.length === 0) {
    tasksList.innerHTML = '<div class="hint">暂无任务记录</div>';
    return;
  }

  data.tasks.forEach((task) => {
    const item = document.createElement("div");
    item.className = "task-item";
    const date = new Date(task.createdAt).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    item.innerHTML = `
      <div class="task-info">
        <span>${date}</span>
        ${task.resultUrl ? `<a href="${task.resultUrl}" target="_blank">查看歌单</a>` : ""}
        ${task.errorMessage ? `<span class="error-text">${task.errorMessage}</span>` : ""}
      </div>
      <span class="task-status ${task.status}">${task.status}</span>
    `;
    tasksList.appendChild(item);
  });
};

// >>> 修改开始：动态行管理函数
let sourceRowCount = 0;

const addSourceRow = (url = "", weight = "") => {
  if (sourceRowCount >= 10) {
    alert("最多只能添加 10 个歌单");
    return;
  }
  sourceRowCount++;

  const row = document.createElement("div");
  row.className = "source-row";
  row.dataset.index = sourceRowCount;

  row.innerHTML = `
    <input type="text" class="source-url" placeholder="https://music.163.com/playlist?id=xxx" value="${url}" required />
    <input type="number" class="source-weight" placeholder="%" value="${weight}" min="0" max="100" />
    ${sourceRowCount > 2 ? `<button type="button" class="remove-btn small" onclick="removeSourceRow(this)">删除</button>` : ""}
  `;

  sourceRowsContainer.appendChild(row);
};

const removeSourceRow = (btn) => {
  if (sourceRowCount <= 2) {
    alert("至少需要 2 个歌单");
    return;
  }
  const row = btn.closest(".source-row");
  row.remove();
  sourceRowCount--;
  reindexRows();
};

const reindexRows = () => {
  const rows = sourceRowsContainer.querySelectorAll(".source-row");
  rows.forEach((row, index) => {
    row.dataset.index = index + 1;
  });
};

const collectSourceData = () => {
  const rows = sourceRowsContainer.querySelectorAll(".source-row");
  const sources = [];
  const weights = [];

  rows.forEach((row) => {
    const urlInput = row.querySelector(".source-url");
    const weightInput = row.querySelector(".source-weight");

    const url = urlInput.value.trim();
    const weight = weightInput.value.trim();

    if (url) {
      sources.push(url);
      weights.push(weight || "");
    }
  });

  // 填充隐藏的 textarea 以保持向后兼容
  document.getElementById("sources").value = sources.join("\n");
  document.getElementById("weights").value = weights.join("\n");

  return { sources, weights };
};

// 初始化 2 个默认行
const initSourceRows = () => {
  sourceRowsContainer.innerHTML = "";
  sourceRowCount = 0;
  addSourceRow();
  addSourceRow();
};

// 新增歌单按钮事件
if (addSourceBtn) {
  addSourceBtn.addEventListener("click", () => addSourceRow());
}
// >>> 修改结束

// Init
checkAuth();