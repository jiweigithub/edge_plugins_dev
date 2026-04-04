(function() {
  'use strict';

  const QUESTION_MARK = '?';
  const LONG_PRESS_INTERVAL = 100;
  const COUNT_REFRESH_INTERVAL = 5 * 60 * 1000;
  const SEND_COOLDOWN = 5000;
  const DANMAKU_SEGMENT_DURATION = 60;

  let pressTimer = null;
  let pressStartTime = 0;
  let questionCount = 0;

  let cachedCount = 0;
  let lastFetchTime = 0;
  let currentBvid = null;
  let lastSendTime = 0;

  let observer = null;
  let observerTarget = null;
  let ensureButtonDebounced = null;
  let countDisplayRef = null;

  function getVideoInfo() {
    const url = window.location.href;
    const bvidMatch = url.match(/\/video\/(BV[\w]+)/);
    if (!bvidMatch) return null;
    return { bvid: bvidMatch[1] };
  }

  async function getCid(bvid) {
    try {
      const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.code === 0) {
        return { cid: data.data.cid, aid: data.data.aid };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function checkLogin() {
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        credentials: 'include'
      });
      const data = await res.json();
      return data.code === 0 && data.data?.isLogin;
    } catch (e) {
      return false;
    }
  }

  function triggerLoginDialog() {
    const loginBtns = document.querySelectorAll('.header-login-entry, .login-tip, .right-entry .item');
    for (const btn of loginBtns) {
      if (btn.textContent.includes('登录')) {
        btn.click();
        return;
      }
    }
    window.open('https://passport.bilibili.com/login', '_blank');
  }

  async function fetchDanmakuCount(bvid) {
    const videoInfo = await getCid(bvid);
    if (!videoInfo) return 0;

    const cid = videoInfo.cid;
    try {
      const res = await fetch(`https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=1`, {
        credentials: 'include'
      });
      if (!res.ok) return 0;
      const buffer = await res.arrayBuffer();
      return countQuestionMarksInProto(buffer);
    } catch (e) {
      return fetchDanmakuCountFallback(cid);
    }
  }

  function countQuestionMarksInProto(buffer) {
    const data = new Uint8Array(buffer);
    let count = 0;
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0x0a) {
        const len = data[i + 1];
        const start = i + 2;
        const end = start + len;
        if (end <= data.length) {
          const segment = data.subarray(start, end);
          count += countQuestionMarksInSegment(segment);
        }
        i = end;
      } else {
        i++;
      }
    }
    return count;
  }

  function countQuestionMarksInSegment(buffer) {
    const data = new Uint8Array(buffer);
    let count = 0;
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0x0a) {
        const len = data[i + 1];
        const start = i + 2;
        const end = start + len;
        if (end <= data.length) {
          const danmakuBytes = data.subarray(start, end);
          count += countQuestionMarksInDanmaku(danmakuBytes);
        }
        i = end;
      } else {
        i++;
      }
    }
    return count;
  }

  function countQuestionMarksInDanmaku(bytes) {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const text = decoder.decode(bytes);
      let count = 0;
      for (const ch of text) {
        if (ch === '?' || ch === '？') count++;
      }
      return count;
    } catch {
      return 0;
    }
  }

  async function fetchDanmakuCountFallback(cid) {
    try {
      const res = await fetch(`https://comment.bilibili.com/${cid}.xml`, {
        credentials: 'include'
      });
      const text = await res.text();
      let count = 0;
      const regex = /<d[^>]*>([^<]*)<\/d>/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const content = match[1];
        for (const ch of content) {
          if (ch === '?' || ch === '？') count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  async function getDanmakuCount(bvid) {
    const now = Date.now();
    if (bvid !== currentBvid) {
      currentBvid = bvid;
      cachedCount = await fetchDanmakuCount(bvid);
      lastFetchTime = now;
      return cachedCount;
    }
    if (now - lastFetchTime >= COUNT_REFRESH_INTERVAL) {
      cachedCount = await fetchDanmakuCount(bvid);
      lastFetchTime = now;
    }
    return cachedCount;
  }

  function addLocalCount(delta) {
    cachedCount += delta;
    return cachedCount;
  }

  function findDanmakuInput() {
    const selectors = [
      '.bpx-player-dm-input',
      '.bilibili-player-video-danmaku-input',
      'input[placeholder*="弹幕"]',
      'input[placeholder*="danmaku"]',
      '.player-auxiliary-area .player-auxiliary-danmaku-input input',
      '.bui-area input.bui-input',
      '#player-ctnr input[type="text"]',
      '[contenteditable="true"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      '.bpx-player-dm-btn',
      '.bilibili-player-video-send-btn',
      '.bpx-player-dm-btn-send',
      '.player-auxiliary-area .player-auxiliary-danmaku-btn-send',
      'button[class*="send"]',
      '.player-auxiliary-area button[class*="danmaku"]',
      '[class*="dm-send"]',
      '[class*="danmaku-send"]',
      'button[aria-label*="发送"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  async function sendDanmaku(text) {
    try {
      const input = findDanmakuInput();
      if (!input) return false;

      input.focus();
      input.click();

      if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (input.isContentEditable) {
        const success = document.execCommand('insertText', false, text);
        if (!success) {
          input.textContent = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      await new Promise(r => setTimeout(r, 100));

      const sendBtn = findSendButton();
      if (sendBtn) {
        sendBtn.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      }

      return true;
    } catch (e) {
      console.warn('[Bilibili ?] Failed to send danmaku:', e);
      return false;
    }
  }

  function showCountAnimation(btn, count) {
    const anim = document.createElement('span');
    anim.className = 'question-count-anim';
    anim.textContent = `? x${count}`;
    btn.appendChild(anim);
    requestAnimationFrame(() => anim.classList.add('show'));
    setTimeout(() => anim.remove(), 800);
  }

  function showClickAnimation(btn) {
    btn.classList.add('question-clicked');
    setTimeout(() => btn.classList.remove('question-clicked'), 300);
  }

  function showErrorAnimation(btn) {
    btn.classList.add('question-error');
    setTimeout(() => btn.classList.remove('question-error'), 1000);
  }

  async function handlePress(btn) {
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) {
      triggerLoginDialog();
      return;
    }

    const now = Date.now();
    if (now - lastSendTime < SEND_COOLDOWN) {
      const remaining = Math.ceil((SEND_COOLDOWN - (now - lastSendTime)) / 1000);
      btn.classList.add('question-cooldown');
      setTimeout(() => btn.classList.remove('question-cooldown'), 500);
      return;
    }

    showClickAnimation(btn);

    const sendCount = questionCount > 0 ? questionCount : 1;
    const questionMarks = QUESTION_MARK.repeat(sendCount);
    const success = await sendDanmaku(questionMarks);

    if (success) {
      lastSendTime = Date.now();
      showCountAnimation(btn, sendCount);
      const newCount = addLocalCount(sendCount);
      if (countDisplayRef) countDisplayRef.textContent = newCount;
    } else {
      showErrorAnimation(btn);
    }
  }

  function createQuestionButton() {
    const btn = document.createElement('div');
    btn.className = 'question-btn video-toolbar-left-item';
    btn.title = '问号弹幕';
    btn.innerHTML = `
      <svg class="question-icon video-toolbar-item-icon" width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M14 25.5C7.649 25.5 2.5 20.351 2.5 14C2.5 7.649 7.649 2.5 14 2.5C20.351 2.5 25.5 7.649 25.5 14C25.5 20.351 20.351 25.5 14 25.5ZM14 4.5C8.753 4.5 4.5 8.753 4.5 14C4.5 19.247 8.753 23.5 14 23.5C19.247 23.5 23.5 19.247 23.5 14C23.5 8.753 19.247 4.5 14 4.5ZM14.5 18.5V19.5C14.5 20.052 14.052 20.5 13.5 20.5C12.948 20.5 12.5 20.052 12.5 19.5V18.5C12.5 17.948 12.948 17.5 13.5 17.5C14.052 17.5 14.5 17.948 14.5 18.5ZM14 8C12.343 8 11 9.343 11 11C11 11.552 11.448 12 12 12C12.552 12 13 11.552 13 11C13 10.448 13.448 10 14 10C14.552 10 15 10.448 15 11C15 11.552 14.552 12.273 14 12.818C13.176 13.636 12.5 14.273 12.5 15.5C12.5 16.052 12.948 16.5 13.5 16.5C14.052 16.5 14.5 16.052 14.5 15.5C14.5 14.977 14.824 14.636 15.5 13.955C16.176 13.273 17 12.5 17 11C17 9.343 15.657 8 14 8Z" fill="currentColor"></path>
      </svg>
      <span class="question-count video-toolbar-item-text">0</span>
    `;

    countDisplayRef = btn.querySelector('.question-count');

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pressStartTime = Date.now();
      questionCount = 0;

      pressTimer = setInterval(() => {
        questionCount++;
        countDisplayRef.textContent = '?' + (questionCount > 1 ? `x${questionCount}` : '');
      }, LONG_PRESS_INTERVAL);
    });

    btn.addEventListener('mouseup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearInterval(pressTimer);
      if (questionCount === 0) {
        questionCount = 1;
      }
      handlePress(btn);
    });

    btn.addEventListener('mouseleave', () => {
      clearInterval(pressTimer);
    });

    return btn;
  }

  function findActionBar() {
    const selectors = [
      '.video-toolbar-left',
      '.ops',
      '.video-toolbar .left',
      '[class*="toolbar"] [class*="left"]',
      '.video-info .ops',
      '.toolbar-left',
      '.video-toolbar-left .toolbar-item'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  async function updateCountDisplay() {
    const videoInfo = getVideoInfo();
    if (!videoInfo) return;
    const count = await getDanmakuCount(videoInfo.bvid);
    if (countDisplayRef) countDisplayRef.textContent = count;
  }

  function injectButton() {
    if (document.querySelector('.question-btn-wrapper')) return true;
    const actionBar = findActionBar();
    if (!actionBar) return false;

    const wrapper = document.createElement('div');
    wrapper.className = 'toolbar-left-item-wrap question-btn-wrapper';
    const btn = createQuestionButton();
    wrapper.appendChild(btn);
    actionBar.appendChild(wrapper);

    if (!observerTarget) {
      observerTarget = actionBar;
      if (observer) observer.disconnect();
      observer.observe(actionBar, { childList: true, subtree: true });
    }

    updateCountDisplay();
    return true;
  }

  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function isVideoPage() {
    return /^https?:\/\/www\.bilibili\.com\/video\//.test(location.href);
  }

  function init() {
    let lastUrl = location.href;

    ensureButtonDebounced = debounce(() => {
      if (!isVideoPage()) {
        if (observer) observer.disconnect();
        observerTarget = null;
        return;
      }
      injectButton();
    }, 200);

    observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        currentBvid = null;
        countDisplayRef = null;
        const existing = document.querySelector('.question-btn-wrapper');
        if (existing) existing.remove();
        observerTarget = null;
        if (observer) observer.disconnect();
      }
      ensureButtonDebounced();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    ensureButtonDebounced();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
