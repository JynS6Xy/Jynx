/**
 * Jynx Interactive Guided Tour
 * High-contrast terminal-style walkthrough of key features
 */
class JynxTour {
  constructor() {
    this.steps = [
      {
        target: "#send-panel",
        title: "STEP 1: SEND FILES OR TEXT",
        desc: "Drag & drop files or type secure text messages. Jynx automatically encrypts your data locally before it leaves your machine.",
        position: "bottom"
      },
      {
        target: "#send-code-container",
        title: "STEP 2: CODE PHRASE & PAKE",
        desc: "This pronounceable 3-part code phrase acts as your Password-Authenticated Key. Share it verbally or copy the link to the recipient.",
        position: "bottom"
      },
      {
        target: "#receive-panel",
        title: "STEP 3: INSTANT RECEIVE",
        desc: "The recipient pastes the code phrase here. Jynx performs an authenticated zero-knowledge handshake and streams the decrypted files directly.",
        position: "bottom"
      },
      {
        target: "#cli-section",
        title: "STEP 4: TERMINAL CLI INTEROPERABILITY",
        desc: "Jynx Web works seamlessly with the native Jynx CLI. Type 'jynx send <file>' in terminal and receive it directly here in browser!",
        position: "top"
      },
      {
        target: "#settings-details",
        title: "STEP 5: SELF-HOSTING & PREFERENCES",
        desc: "Configure your own self-hosted relay server, encryption parameters, sound effects, or enable auto-accept for automated pipelines.",
        position: "top"
      }
    ];

    this.currentStep = 0;
    this.overlay = null;
    this.popover = null;
  }

  start() {
    this.currentStep = 0;
    this.createElements();
    this.renderStep();
  }

  createElements() {
    this.cleanup();

    this.overlay = document.createElement("div");
    this.overlay.className = "jynx-tour-overlay";
    this.overlay.addEventListener("click", () => this.cleanup());
    document.body.appendChild(this.overlay);

    this.popover = document.createElement("div");
    this.popover.className = "jynx-tour-popover";
    document.body.appendChild(this.popover);
  }

  renderStep() {
    const step = this.steps[this.currentStep];
    const targetEl = document.querySelector(step.target);

    // Highlight target element
    document.querySelectorAll(".jynx-tour-highlight").forEach(el => el.classList.remove("jynx-tour-highlight"));
    if (targetEl) {
      targetEl.classList.add("jynx-tour-highlight");
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const isLast = this.currentStep === this.steps.length - 1;
    const isFirst = this.currentStep === 0;

    this.popover.innerHTML = `
      <div class="tour-header">
        <span class="tour-step-badge">[${this.currentStep + 1}/${this.steps.length}]</span>
        <strong class="tour-title">${step.title}</strong>
        <button class="tour-close-btn" aria-label="Close Tour">&times;</button>
      </div>
      <p class="tour-desc">${step.desc}</p>
      <div class="tour-footer">
        <button class="tour-btn tour-prev-btn" ${isFirst ? "disabled" : ""}>&larr; Prev</button>
        <button class="tour-btn tour-next-btn">${isLast ? "Finish &times;" : "Next &rarr;"}</button>
      </div>
    `;

    // Position popover relative to target
    setTimeout(() => {
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const popoverRect = this.popover.getBoundingClientRect();
        
        let top = rect.bottom + window.scrollY + 12;
        let left = rect.left + window.scrollX;

        if (step.position === "top" || top + popoverRect.height > window.innerHeight + window.scrollY) {
          top = rect.top + window.scrollY - popoverRect.height - 12;
        }

        // Keep inside viewport horizontally
        if (left + popoverRect.width > window.innerWidth - 20) {
          left = window.innerWidth - popoverRect.width - 20;
        }
        if (left < 10) left = 10;
        if (top < 10) top = 10;

        this.popover.style.top = `${top}px`;
        this.popover.style.left = `${left}px`;
      }
    }, 50);

    // Event handlers
    this.popover.querySelector(".tour-close-btn").addEventListener("click", () => this.cleanup());
    this.popover.querySelector(".tour-prev-btn").addEventListener("click", () => {
      if (this.currentStep > 0) {
        this.currentStep--;
        this.renderStep();
      }
    });
    this.popover.querySelector(".tour-next-btn").addEventListener("click", () => {
      if (isLast) {
        this.cleanup();
      } else {
        this.currentStep++;
        this.renderStep();
      }
    });
  }

  cleanup() {
    document.querySelectorAll(".jynx-tour-highlight").forEach(el => el.classList.remove("jynx-tour-highlight"));
    if (this.overlay) this.overlay.remove();
    if (this.popover) this.popover.remove();
    this.overlay = null;
    this.popover = null;
  }
}

window.jynxTour = new JynxTour();
