/**
 * Jynx Web Application Core Controller
 * Orchestrates UI state, events, drag-and-drop, theme toggles, and transfer flows.
 */

document.addEventListener("DOMContentLoaded", () => {
  // State variables
  let currentSendMode = "files"; // 'files' | 'text' | 'vault'
  let selectedFiles = [];
  let currentCode = "";
  let isSending = false;
  let isReceiving = false;

  // Initialize theme
  initTheme();

  // Initialize code phrase from selected payload/files
  updateIntendedFileCode();

  // Initialize UI Event Listeners
  initHeaderActions();
  initSendPanel();
  initSmtpConfig();
  initReceivePanel();
  initCliSection();
  initSettingsModal();
  initToolsMenu();
  initUrlParameters();

  // Initialize visualizers
  if (window.jynxVisualizer) {
    window.jynxVisualizer.init();
  }

  /* ----------------------------------------------------
   * THEME MANAGEMENT
   * ---------------------------------------------------- */
  function initTheme() {
    let savedTheme = "dark";
    try {
      savedTheme = localStorage.getItem("jynx-web-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    } catch (e) {}

    setTheme(savedTheme);

    const themeToggleBtn = document.getElementById("theme-toggle");
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener("click", () => {
        const current = document.documentElement.dataset.theme || "dark";
        const next = current === "dark" ? "light" : "dark";
        setTheme(next);
        window.jynxSettings?.playSound("click");
      });
    }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("jynx-web-theme", theme);
    } catch (e) {}

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", theme === "dark" ? "#121411" : "#f2f1ec");
    }
  }

  /* ----------------------------------------------------
   * HEADER & TOP BAR
   * ---------------------------------------------------- */
  function initHeaderActions() {
    const tourBtn = document.getElementById("tour-btn");
    if (tourBtn) {
      tourBtn.addEventListener("click", () => {
        window.jynxTour?.start();
        window.jynxSettings?.playSound("click");
      });
    }

    const soundToggleBtn = document.getElementById("sound-toggle");
    if (soundToggleBtn) {
      soundToggleBtn.addEventListener("click", () => {
        const current = window.jynxSettings.get("soundEnabled");
        window.jynxSettings.set("soundEnabled", !current);
        soundToggleBtn.classList.toggle("active", !current);
        soundToggleBtn.title = !current ? "Sound FX: ON" : "Sound FX: OFF";
        window.jynxSettings.playSound("click");
      });
    }

    // Mobile panel switcher
    const mobileSwitchBtns = document.querySelectorAll(".mobile-transfer-switch button");
    mobileSwitchBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        mobileSwitchBtns.forEach(b => {
          b.setAttribute("aria-selected", "false");
          b.classList.remove("active");
        });
        btn.setAttribute("aria-selected", "true");
        btn.classList.add("active");

        const target = btn.dataset.panel;
        const sendPanel = document.getElementById("send-panel");
        const receivePanel = document.getElementById("receive-panel");

        if (target === "send") {
          sendPanel.classList.add("mobile-active");
          receivePanel.classList.remove("mobile-active");
        } else {
          sendPanel.classList.remove("mobile-active");
          receivePanel.classList.add("mobile-active");
        }
        window.jynxSettings?.playSound("click");
      });
    });
  }

  /* ----------------------------------------------------
   * CODE GENERATION & SHARING (AUTO-GENERATED FOR FILE)
   * ---------------------------------------------------- */
  function updateIntendedFileCode() {
    if (currentSendMode === "files" || currentSendMode === "vault") {
      currentCode = JynxTools.generateFileCodePhrase(selectedFiles, currentSendMode, "");
    } else {
      const textInput = document.getElementById("secret-text-input");
      const textVal = textInput ? textInput.value : "";
      currentCode = JynxTools.generateFileCodePhrase([], "text", textVal);
    }
    updateCodeDisplay();
  }

  function updateCodeDisplay() {
    const codeValEl = document.getElementById("send-code-val");
    const shareInput = document.getElementById("direct-share-input");
    const cliPreview = document.getElementById("cli-code-preview");
    const autoTagEl = document.getElementById("code-auto-tag");

    const isPlaceholder = currentCode === "select-files-to-generate" || currentCode === "enter-text-to-generate";

    if (codeValEl) {
      codeValEl.textContent = currentCode;
      codeValEl.style.opacity = isPlaceholder ? "0.6" : "1";
    }

    if (autoTagEl) {
      autoTagEl.textContent = isPlaceholder ? "[AUTO-GENERATES ON SELECTION]" : "[AUTO-GENERATED FOR INTENDED FILE]";
    }

    const fullUrl = isPlaceholder
      ? ""
      : `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(currentCode)}`;
    
    if (shareInput) {
      shareInput.value = fullUrl;
      shareInput.placeholder = "Select files above to generate share link";
    }
    if (cliPreview) cliPreview.textContent = currentCode;

    // Update QR Code
    const qrRegion = document.getElementById("share-qr-svg");
    if (qrRegion) {
      qrRegion.innerHTML = JynxTools.generateQRCodeSVG(fullUrl || window.location.href, 200);
    }

    // Update Gmail Web Quick Link if visible
    updateGmailWebButton();
  }

  /* ----------------------------------------------------
   * GMAIL / SMTP CONFIGURATION PANEL
   * ---------------------------------------------------- */
  function initSmtpConfig() {
    const toggleBtn = document.getElementById("toggle-smtp-btn");
    const panel = document.getElementById("smtp-config-panel");
    const userInput = document.getElementById("smtp-user-input");
    const passInput = document.getElementById("smtp-pass-input");
    const hostInput = document.getElementById("smtp-host-input");
    const portInput = document.getElementById("smtp-port-input");
    const togglePassBtn = document.getElementById("toggle-smtp-pass-btn");
    const testBtn = document.getElementById("test-smtp-btn");
    const saveBtn = document.getElementById("save-smtp-btn");
    const statusEl = document.getElementById("smtp-test-status");
    const badgeEl = document.getElementById("smtp-badge");
    const receiverEmailInput = document.getElementById("receiver-email-input");
    const openGmailWebBtn = document.getElementById("open-gmail-web-btn");

    // Load saved SMTP configuration from localStorage
    try {
      const saved = localStorage.getItem("jynx-smtp-config");
      let config = saved ? JSON.parse(saved) : {};
      
      if (config.user && userInput) userInput.value = config.user;
      if (config.pass && passInput) passInput.value = config.pass;
      if (config.host && hostInput) hostInput.value = config.host;
      if (config.port && portInput) portInput.value = config.port;

      if (badgeEl && config.user) {
        badgeEl.textContent = `Configured (${config.user})`;
        badgeEl.style.color = "var(--accent)";
      }
    } catch (e) {}

    if (toggleBtn && panel) {
      toggleBtn.addEventListener("click", () => {
        const isHidden = panel.style.display === "none" || !panel.style.display;
        panel.style.display = isHidden ? "block" : "none";
        toggleBtn.textContent = isHidden ? "▲ Hide SMTP Settings" : "⚙ Configure Gmail / SMTP";
        window.jynxSettings?.playSound("click");
      });
    }

    if (togglePassBtn && passInput) {
      togglePassBtn.addEventListener("click", () => {
        const isPassword = passInput.type === "password";
        passInput.type = isPassword ? "text" : "password";
        togglePassBtn.textContent = isPassword ? "🙈" : "👁";
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const config = {
          user: userInput?.value.trim() || "",
          pass: passInput?.value.trim() || "",
          host: hostInput?.value.trim() || "smtp.gmail.com",
          port: parseInt(portInput?.value.trim() || "587", 10)
        };
        try {
          localStorage.setItem("jynx-smtp-config", JSON.stringify(config));
          if (badgeEl) {
            badgeEl.textContent = config.user ? `Configured (${config.user})` : "Using server defaults";
            badgeEl.style.color = config.user ? "var(--accent)" : "var(--muted)";
          }
          if (statusEl) {
            statusEl.innerHTML = '<span style="color:var(--accent);">✓ Credentials saved locally!</span>';
          }
          window.jynxSettings?.playSound("success");
          setTimeout(() => {
            if (statusEl) statusEl.innerHTML = "";
          }, 3000);
        } catch (e) {
          alert("Could not save settings: " + e.message);
        }
      });
    }

    if (testBtn) {
      testBtn.addEventListener("click", async () => {
        const config = {
          user: userInput?.value.trim() || "",
          pass: passInput?.value.trim() || "",
          host: hostInput?.value.trim() || "smtp.gmail.com",
          port: parseInt(portInput?.value.trim() || "587", 10)
        };

        if (!config.user || !config.pass) {
          if (statusEl) {
            statusEl.innerHTML = '<span style="color:var(--danger);">Please enter Sender Gmail and 16-char App Password.</span>';
          }
          return;
        }

        testBtn.disabled = true;
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted);">Testing connection to ' + escapeHtml(config.host) + '...</span>';

        try {
          const res = await fetch("/api/test-smtp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ smtp_config: config })
          });
          const data = await res.json();
          if (res.ok && data.status === "SUCCESS") {
            if (statusEl) {
              statusEl.innerHTML = '<span style="color:var(--accent);">✓ ' + escapeHtml(data.message) + '</span>';
            }
            window.jynxSettings?.playSound("success");
          } else {
            throw new Error(data.error || "Authentication failed.");
          }
        } catch (err) {
          if (statusEl) {
            statusEl.innerHTML = '<span style="color:var(--danger);">' + escapeHtml(err.message) + '</span>';
          }
          window.jynxSettings?.playSound("error");
        } finally {
          testBtn.disabled = false;
        }
      });
    }

    if (receiverEmailInput) {
      receiverEmailInput.addEventListener("input", updateGmailWebButton);
    }

    if (openGmailWebBtn) {
      openGmailWebBtn.addEventListener("click", () => {
        const toEmail = receiverEmailInput?.value.trim() || "";
        const shareUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(currentCode)}`;
        const manifest = {
          type: currentSendMode,
          filesCount: selectedFiles.length,
          files: selectedFiles.map(f => ({ name: f.name }))
        };
        const composeUrl = window.jynxTransferEngine.getGmailComposeUrl({
          to_email: toEmail,
          code: currentCode,
          share_url: shareUrl,
          manifest: manifest
        });
        window.open(composeUrl, "_blank");
        window.jynxSettings?.playSound("click");
      });
    }
  }

  function updateGmailWebButton() {
    const receiverEmailInput = document.getElementById("receiver-email-input");
    const openGmailWebBtn = document.getElementById("open-gmail-web-btn");
    if (!openGmailWebBtn) return;
    const hasEmail = receiverEmailInput && receiverEmailInput.value.trim().length > 0;
    openGmailWebBtn.style.display = hasEmail ? "block" : "none";
  }

  /* ----------------------------------------------------
   * SEND PANEL LOGIC
   * ---------------------------------------------------- */
  function initSendPanel() {
    // Mode Switcher (Files vs Text vs Stored Vault)
    const modeBtns = document.querySelectorAll(".send-mode-switch button");
    const dropZone = document.getElementById("drop-zone");
    const textComposer = document.getElementById("text-composer");
    const vaultNote = document.getElementById("vault-privacy-note");

    modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        modeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentSendMode = btn.dataset.mode;

        if (currentSendMode === "files") {
          dropZone.style.display = "";
          textComposer.style.display = "none";
          if (vaultNote) vaultNote.style.display = "none";
        } else if (currentSendMode === "text") {
          dropZone.style.display = "none";
          textComposer.style.display = "";
          if (vaultNote) vaultNote.style.display = "none";
        } else if (currentSendMode === "vault") {
          dropZone.style.display = "";
          textComposer.style.display = "none";
          if (vaultNote) vaultNote.style.display = "block";
        }

        updateIntendedFileCode();
        updateSendButtonState();
        window.jynxSettings?.playSound("click");
      });
    });

    // Dropzone & File Input
    const fileInput = document.getElementById("file-input");
    const fileListEl = document.getElementById("selected-files-list");
    const selectionSummary = document.getElementById("selection-summary");

    dropZone.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", (e) => {
      handleFilesSelected(Array.from(e.target.files));
      fileInput.value = "";
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.dataset.dragging = "true";
    });

    dropZone.addEventListener("dragleave", () => {
      delete dropZone.dataset.dragging;
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      delete dropZone.dataset.dragging;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesSelected(Array.from(e.dataTransfer.files));
      }
    });

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

    function handleFilesSelected(files) {
      const pendingFiles = [...selectedFiles, ...files];
      const pendingTotalSize = pendingFiles.reduce((acc, f) => acc + f.size, 0);

      if (pendingTotalSize > MAX_FILE_SIZE) {
        alert("File selection exceeds the maximum limit of 50 MB per transfer.");
        return;
      }

      selectedFiles = pendingFiles;
      renderFileList();
      updateIntendedFileCode();
      updateSendButtonState();
      window.jynxSettings?.playSound("click");
    }

    function renderFileList() {
      if (!fileListEl) return;
      fileListEl.innerHTML = "";

      if (selectedFiles.length === 0) {
        fileListEl.style.display = "none";
        if (selectionSummary) selectionSummary.textContent = "0 files selected (0 Bytes)";
        return;
      }

      fileListEl.style.display = "block";
      let totalBytes = 0;

      selectedFiles.forEach((file, index) => {
        totalBytes += file.size;
        const li = document.createElement("li");
        li.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
            <polyline points="13 2 13 9 20 9"></polyline>
          </svg>
          <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="file-size">${JynxTools.formatBytes(file.size)}</span>
          <button class="list-action" title="Remove file" data-index="${index}">&times;</button>
        `;

        li.querySelector(".list-action").addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectedFiles.splice(index, 1);
          renderFileList();
          updateIntendedFileCode();
          updateSendButtonState();
          window.jynxSettings?.playSound("click");
        });

        fileListEl.appendChild(li);
      });

      if (selectionSummary) {
        selectionSummary.textContent = `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected (${JynxTools.formatBytes(totalBytes)})`;
      }
    }

    // Text composer character counter & code update
    const textInput = document.getElementById("secret-text-input");
    const charCountEl = document.getElementById("text-char-count");
    if (textInput) {
      textInput.addEventListener("input", () => {
        const len = textInput.value.length;
        const bytes = new TextEncoder().encode(textInput.value).byteLength;
        if (charCountEl) {
          charCountEl.textContent = `${len} chars (${JynxTools.formatBytes(bytes)})`;
        }
        updateIntendedFileCode();
        updateSendButtonState();
      });
    }

    // Copy code button
    const copyCodeBtn = document.getElementById("copy-code-btn");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", () => {
        if (!currentCode || currentCode.startsWith("select-") || currentCode.startsWith("enter-")) {
          return;
        }
        navigator.clipboard.writeText(currentCode);
        copyCodeBtn.classList.add("copied");
        const valEl = document.getElementById("send-code-val");
        valEl?.classList.add("copied");
        window.jynxSettings?.playSound("click");

        setTimeout(() => {
          copyCodeBtn.classList.remove("copied");
          valEl?.classList.remove("copied");
        }, 1200);
      });
    }

    const copyLinkBtn = document.getElementById("copy-link-btn");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", () => {
        const shareInput = document.getElementById("direct-share-input");
        if (shareInput && shareInput.value) {
          navigator.clipboard.writeText(shareInput.value);
          copyLinkBtn.textContent = "COPIED!";
          window.jynxSettings?.playSound("click");
          setTimeout(() => {
            copyLinkBtn.textContent = "COPY LINK";
          }, 1500);
        }
      });
    }

    // QR Code toggle modal
    const qrToggleBtn = document.getElementById("qr-toggle-btn");
    const qrRegion = document.getElementById("share-qr-wrapper");
    if (qrToggleBtn && qrRegion) {
      qrToggleBtn.addEventListener("click", () => {
        const isHidden = qrRegion.style.display === "none" || !qrRegion.style.display;
        qrRegion.style.display = isHidden ? "grid" : "none";
        qrToggleBtn.textContent = isHidden ? "HIDE QR CODE" : "SHOW QR CODE";
        window.jynxSettings?.playSound("click");
      });
    }

    // Send Trigger Button
    const sendBtn = document.getElementById("start-send-btn");
    if (sendBtn) {
      sendBtn.addEventListener("click", handleSend);
    }
  }

  function updateSendButtonState() {
    const sendBtn = document.getElementById("start-send-btn");
    if (!sendBtn) return;

    if (currentSendMode === "files" || currentSendMode === "vault") {
      sendBtn.disabled = selectedFiles.length === 0;
      sendBtn.textContent = selectedFiles.length > 0 
        ? `SEND ${selectedFiles.length} FILE${selectedFiles.length > 1 ? "S" : ""} NOW`
        : "SELECT FILES TO SEND";
    } else {
      const textInput = document.getElementById("secret-text-input");
      const hasText = textInput && textInput.value.trim().length > 0;
      sendBtn.disabled = !hasText;
      sendBtn.textContent = hasText ? "SEND ENCRYPTED TEXT" : "ENTER TEXT TO SEND";
    }
  }

  async function handleSend() {
    if (isSending) return;
    isSending = true;

    const sendBtn = document.getElementById("start-send-btn");
    const sendStatus = document.getElementById("send-status-msg");
    const sendProgress = document.getElementById("send-progress-block");

    sendBtn.disabled = true;
    sendBtn.classList.add("loading");
    window.jynxSettings?.playSound("connect");

    const textInput = document.getElementById("secret-text-input");
    const payloadText = textInput ? textInput.value : "";
    const receiverEmailInput = document.getElementById("receiver-email-input");
    const receiverEmail = receiverEmailInput ? receiverEmailInput.value.trim() : "";

    try {
      const result = await window.jynxTransferEngine.startSend({
        code: currentCode,
        mode: currentSendMode,
        files: selectedFiles,
        text: payloadText,
        receiverEmail: receiverEmail,
        onStatus: (msg, stage) => {
          if (sendStatus) {
            sendStatus.innerHTML = `<span class="status-indicator"></span> ${escapeHtml(msg)}`;
            sendStatus.className = `status-message ${stage}`;
          }
        },
        onProgress: (prog) => {
          if (sendProgress) {
            sendProgress.style.display = "block";
            const bar = sendProgress.querySelector(".progress-track span");
            const metrics = sendProgress.querySelector(".progress-speed");
            if (bar) bar.style.width = `${prog.percent}%`;
            if (metrics) metrics.textContent = `${JynxTools.formatSpeed(prog.speed)} • ETA ${JynxTools.formatSeconds(prog.eta)}`;
          }
        }
      });

      window.jynxSettings?.playSound("success");
      if (sendStatus) {
        let emailNotice = "";
        const shareUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(currentCode)}`;

        if (receiverEmail) {
          if (result.emailStatus && result.emailStatus.success) {
            emailNotice = `
              <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--soft-border); color:var(--accent); font-size:11px;">
                ✓ Notification email sent successfully via Gmail SMTP to <strong>${escapeHtml(receiverEmail)}</strong>
              </div>
            `;
          } else {
            const errReason = result.emailStatus?.error || "SMTP not configured or failed";
            const composeUrl = window.jynxTransferEngine.getGmailComposeUrl({
              to_email: receiverEmail,
              code: currentCode,
              share_url: shareUrl,
              manifest: result.manifest
            });
            emailNotice = `
              <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--soft-border); color:var(--danger); font-size:11px;">
                ⚠ Email notice: ${escapeHtml(errReason)}.
                <a href="${escapeHtml(composeUrl)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline; margin-left:6px; font-weight:bold;">
                  Open & Send in Gmail Web &rarr;
                </a>
              </div>
            `;
          }
        }

        sendStatus.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <div>
            Ready on relay. Auto-generated Code: <strong>${currentCode}</strong> (Verification: <strong>${result.verification}</strong>)
            ${emailNotice}
          </div>
        `;
        sendStatus.className = "status-message done";
      }
    } catch (err) {
      window.jynxSettings?.playSound("error");
      if (sendStatus) {
        sendStatus.textContent = `Error: ${err.message}`;
        sendStatus.className = "status-message error";
      }
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      sendBtn.classList.remove("loading");
      updateSendButtonState();
    }
  }

  /* ----------------------------------------------------
   * RECEIVE PANEL LOGIC
   * ---------------------------------------------------- */
  function initReceivePanel() {
    const codeInput = document.getElementById("receive-code-input");
    const receiveBtn = document.getElementById("start-receive-btn");
    const pasteBtn = document.getElementById("paste-code-btn");
    const statusMsg = document.getElementById("receive-status-msg");
    const progressBlock = document.getElementById("receive-progress-block");
    const offerSection = document.getElementById("receive-offer-section");
    const textSection = document.getElementById("receive-text-section");

    if (pasteBtn && codeInput) {
      pasteBtn.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            codeInput.value = text.trim();
            window.jynxSettings?.playSound("click");
          }
        } catch (e) {}
      });
    }

    if (receiveBtn && codeInput) {
      receiveBtn.addEventListener("click", () => {
        const code = codeInput.value.trim();
        if (!code) {
          codeInput.focus();
          return;
        }
        executeReceive(code);
      });

      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          receiveBtn.click();
        }
      });
    }

    async function executeReceive(code) {
      if (isReceiving) return;
      isReceiving = true;

      receiveBtn.disabled = true;
      receiveBtn.classList.add("loading");
      if (offerSection) offerSection.style.display = "none";
      if (textSection) textSection.style.display = "none";
      if (progressBlock) progressBlock.style.display = "block";

      window.jynxSettings?.playSound("connect");

      try {
        const result = await window.jynxTransferEngine.startReceive({
          code: code,
          onStatus: (msg, stage) => {
            if (statusMsg) {
              statusMsg.innerHTML = `<span class="status-indicator"></span> ${escapeHtml(msg)}`;
              statusMsg.className = `status-message ${stage}`;
            }
          },
          onProgress: (prog) => {
            if (progressBlock) {
              const bar = progressBlock.querySelector(".progress-track span");
              const speedEl = progressBlock.querySelector(".progress-speed");
              const percentEl = progressBlock.querySelector(".progress-percent");
              const transferredEl = progressBlock.querySelector(".progress-transferred");

              if (bar) bar.style.width = `${prog.percent}%`;
              if (percentEl) percentEl.textContent = `${prog.percent}%`;
              if (speedEl) speedEl.textContent = JynxTools.formatSpeed(prog.speed);
              if (transferredEl) transferredEl.textContent = `${JynxTools.formatBytes(prog.transferred)} / ${JynxTools.formatBytes(prog.totalBytes)}`;
            }
          }
        });

        window.jynxSettings?.playSound("success");

        if (statusMsg) {
          statusMsg.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Transfer complete! Verified PAKE: <strong>${result.verification}</strong>
          `;
          statusMsg.className = "status-message done";
        }

        // Render Received Content
        if (result.type === "text") {
          if (textSection) {
            textSection.style.display = "grid";
            const textPre = textSection.querySelector("pre");
            if (textPre) textPre.textContent = result.text;

            const copyTextBtn = textSection.querySelector(".copy-received-text-btn");
            if (copyTextBtn) {
              copyTextBtn.onclick = () => {
                navigator.clipboard.writeText(result.text);
                copyTextBtn.textContent = "COPIED!";
                window.jynxSettings?.playSound("click");
                setTimeout(() => copyTextBtn.textContent = "COPY TEXT", 1500);
              };
            }
          }
        } else if (result.type === "files") {
          if (offerSection) {
            offerSection.style.display = "block";
            const fileList = offerSection.querySelector(".offer-list");
            if (fileList) {
              fileList.innerHTML = "";
              result.files.forEach(file => {
                const li = document.createElement("li");
                li.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                  </svg>
                  <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                  <span class="file-size">${JynxTools.formatBytes(file.size)}</span>
                  <a href="${file.url}" download="${escapeHtml(file.name)}" class="secondary-button download-file-btn" style="min-height:30px; padding:4px 8px; font-size:10px;">DOWNLOAD</a>
                `;
                fileList.appendChild(li);
              });
            }

            const downloadAllBtn = offerSection.querySelector(".download-all-btn");
            if (downloadAllBtn) {
              downloadAllBtn.onclick = () => {
                result.files.forEach(file => {
                  const a = document.createElement("a");
                  a.href = file.url;
                  a.download = file.name;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                });
                window.jynxSettings?.playSound("success");
              };
            }
          }
        }
      } catch (err) {
        window.jynxSettings?.playSound("error");
        if (statusMsg) {
          statusMsg.textContent = `Error: ${err.message}`;
          statusMsg.className = "status-message error";
        }
      } finally {
        isReceiving = false;
        receiveBtn.disabled = false;
        receiveBtn.classList.remove("loading");
      }
    }
  }

  /* ----------------------------------------------------
   * CLI SECTION TABS & INSTALL ACTIONS
   * ---------------------------------------------------- */
  function initCliSection() {
    const cliTabs = document.querySelectorAll(".cli-install-tab");
    const cliCodeBlock = document.getElementById("cli-install-command");
    const copyCliBtn = document.getElementById("copy-cli-command-btn");

    const commands = {
      curl: "curl -sL https://getjynx.dev/install.sh | bash",
      brew: "brew install jynx",
      winget: "winget install jynx-cli",
      scoop: "scoop install jynx",
      npm: "npm install -g jynx-cli",
      docker: "docker run -it --rm jynx/relay"
    };

    cliTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        cliTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const method = tab.dataset.method;
        if (cliCodeBlock && commands[method]) {
          cliCodeBlock.textContent = commands[method];
        }
        window.jynxSettings?.playSound("click");
      });
    });

    if (copyCliBtn && cliCodeBlock) {
      copyCliBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(cliCodeBlock.textContent);
        copyCliBtn.textContent = "COPIED!";
        window.jynxSettings?.playSound("click");
        setTimeout(() => copyCliBtn.textContent = "COPY", 1200);
      });
    }
  }

  /* ----------------------------------------------------
   * SETTINGS MODAL & PERSISTENCE
   * ---------------------------------------------------- */
  function initSettingsModal() {
    const relayInput = document.getElementById("setting-relay-address");
    const passwordInput = document.getElementById("setting-relay-password");
    const cipherSelect = document.getElementById("setting-cipher-select");
    const autoAcceptCheck = document.getElementById("setting-auto-accept");
    const saveBtn = document.getElementById("save-settings-btn");

    if (relayInput) relayInput.value = window.jynxSettings.get("relayAddress");
    if (passwordInput) passwordInput.value = window.jynxSettings.get("relayPassword");
    if (cipherSelect) cipherSelect.value = window.jynxSettings.get("cipher");
    if (autoAcceptCheck) autoAcceptCheck.checked = window.jynxSettings.get("autoAccept");

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        window.jynxSettings.saveSettings({
          relayAddress: relayInput?.value.trim(),
          relayPassword: passwordInput?.value.trim(),
          cipher: cipherSelect?.value,
          autoAccept: autoAcceptCheck?.checked
        });
        saveBtn.textContent = "SAVED!";
        window.jynxSettings?.playSound("success");
        setTimeout(() => saveBtn.textContent = "SAVE PREFERENCES", 1500);
      });
    }
  }

  /* ----------------------------------------------------
   * TOOLS MENU & QUICK DIALOGS
   * ---------------------------------------------------- */
  function initToolsMenu() {
    const pingToolBtn = document.getElementById("tool-ping-relay");
    const pingResultModal = document.getElementById("ping-result-modal");

    if (pingToolBtn) {
      pingToolBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        pingToolBtn.textContent = "PINGING...";
        const relay = window.jynxSettings.get("relayAddress");
        const res = await JynxTools.testRelayPing(relay);
        alert(`JYNX RELAY PING REPORT:\n\nRelay: ${res.relay}\nStatus: ${res.status}\nLatency: ${res.latencyMs}ms\nTLS: ${res.tls}\nProtocol: ${res.protocol}`);
        pingToolBtn.textContent = "Ping Relay";
        window.jynxSettings?.playSound("success");
      });
    }
  }

  /* ----------------------------------------------------
   * URL PARAMETER AUTOLOAD (?code=...)
   * ---------------------------------------------------- */
  function initUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code");
    if (codeParam) {
      const receiveInput = document.getElementById("receive-code-input");
      if (receiveInput) {
        receiveInput.value = codeParam;
        // Switch to receive panel on mobile
        const receivePanel = document.getElementById("receive-panel");
        const sendPanel = document.getElementById("send-panel");
        if (receivePanel && sendPanel) {
          sendPanel.classList.remove("mobile-active");
          receivePanel.classList.add("mobile-active");
        }
        // Auto scroll to receive panel
        receivePanel?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }

  /* ----------------------------------------------------
   * DATABASE TELEMETRY & STATUS MONITOR
   * ---------------------------------------------------- */
  async function initDatabaseTelemetry() {
    const badge = document.getElementById("db-status-badge");
    try {
      const res = await fetch("/api/relay/stats");
      if (res.ok) {
        const stats = await res.json();
        if (badge) {
          badge.innerHTML = `<span class="status-indicator"></span> <span>DATABASE RELAY: ONLINE (SQLite &bull; ${stats.active_rooms} active room${stats.active_rooms === 1 ? '' : 's'})</span>`;
          badge.style.color = "var(--accent)";
        }
      }
    } catch (e) {
      if (badge) {
        badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--subtle);display:inline-block;"></span> <span>DATABASE RELAY: LOCAL MESH</span>`;
        badge.style.color = "var(--muted)";
      }
    }
  }

  initDatabaseTelemetry();
  setInterval(initDatabaseTelemetry, 15000);

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }
});
