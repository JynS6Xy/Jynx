/**
 * Jynx Interactive Cryptography & Protocol Visualizer
 * Provides animated diagrams for PAKE handshake, key derivation, and network topology.
 */
class JynxVisualizer {
  constructor() {
    this.animationTimer = null;
    this.step = 0;
  }

  /**
   * Initializes the visualizer components on the page
   */
  init() {
    this.initHandshakeVisualizer();
    this.initKeyDerivationDemo();
    this.initComparisonFilter();
  }

  /**
   * Interactive Handshake Flow Visualizer
   */
  initHandshakeVisualizer() {
    const handshakeBox = document.getElementById("visualizer-handshake");
    if (!handshakeBox) return;

    const steps = [
      { text: "1. Alice generates code phrase & registers with Jynx Relay", packet: "left-to-mid" },
      { text: "2. Bob enters code phrase & requests room rendezvous", packet: "right-to-mid" },
      { text: "3. Relay bridges connection without learning the key (PAKE)", packet: "mid-pulse" },
      { text: "4. SPAKE2 computes mutually authenticated 256-bit shared session key", packet: "both-ends" },
      { text: "5. Direct P2P AES-GCM encrypted binary stream begins", packet: "full-stream" }
    ];

    let currentStep = 0;
    const updateStep = () => {
      const stepData = steps[currentStep];
      const descEl = handshakeBox.querySelector(".handshake-step-desc");
      const packetEl = handshakeBox.querySelector(".handshake-packet-anim");
      
      if (descEl) {
        descEl.textContent = stepData.text;
      }
      if (packetEl) {
        packetEl.className = `handshake-packet-anim ${stepData.packet}`;
      }

      currentStep = (currentStep + 1) % steps.length;
    };

    updateStep();
    setInterval(updateStep, 3500);
  }

  /**
   * Interactive Key Derivation Live Calculation Demo
   */
  initKeyDerivationDemo() {
    const input = document.getElementById("pake-demo-input");
    const outputHash = document.getElementById("pake-demo-key");
    const outputSalt = document.getElementById("pake-demo-salt");

    if (!input || !outputHash) return;

    const updateCalculations = async () => {
      const phrase = input.value.trim() || "7492-velvet-falcon";
      try {
        const encoder = new TextEncoder();
        const hashBuf = await window.crypto.subtle.digest("SHA-256", encoder.encode(phrase));
        const hashArr = Array.from(new Uint8Array(hashBuf));
        const hex = hashArr.map(b => b.toString(16).padStart(2, "0")).join("");
        
        outputHash.textContent = `0x${hex.slice(0, 32)}... [256-bit AES]`;
        if (outputSalt) {
          outputSalt.textContent = `Salt: 0x${hex.slice(32, 48)}`;
        }
      } catch (e) {
        console.error(e);
      }
    };

    input.addEventListener("input", updateCalculations);
    updateCalculations();
  }

  /**
   * Interactive Comparison Table Filtering
   */
  initComparisonFilter() {
    const tabs = document.querySelectorAll(".comparison-filter-btn");
    const rows = document.querySelectorAll(".comparison-table tbody tr");

    tabs.forEach(btn => {
      btn.addEventListener("click", () => {
        tabs.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const filter = btn.dataset.filter;
        rows.forEach(row => {
          if (filter === "all" || row.dataset.category === filter) {
            row.style.display = "";
          } else {
            row.style.display = "none";
          }
        });
      });
    });
  }
}

window.jynxVisualizer = new JynxVisualizer();
