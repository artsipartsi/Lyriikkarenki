import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lyriikkarenki – v0.1
 * - Pieni, keskitetty otsikko + versio
 * - Asetukset-paneeli (hammasratas)
 * - Valinnat: kielikuvia, synonyymejä, riimiehdotuksia
 * - Vapaamuotoinen ohje (3 riviä)
 * - Villiyden liukusäädin (0.0–1.0)
 * - Sanoittajan ikkuna (muokattava) + Rengin ikkuna (readOnly)
 * - Ehdota-painike muodostaa promptin ja kutsuu /api/chat
 * - Peru / Uudelleen -historia sanoittajan tekstille
 */

export default function App() {
  // --- UI ---
  const [showSettings, setShowSettings] = useState(() => {
    const saved = localStorage.getItem("lr_showSettings");
    return saved ? saved === "true" : true;
  });

  // --- Valinnat (persist) ---
  const [wantMetaphors, setWantMetaphors] = useState(() => lsBool("lr_metaphors", true));
  const [wantSynonyms, setWantSynonyms] = useState(() => lsBool("lr_synonyms", true));
  const [wantRhymes, setWantRhymes] = useState(() => lsBool("lr_rhymes", true));
  const [wildness, setWildness] = useState(() => {
    const s = localStorage.getItem("lr_wildness");
    return s ? Number(s) : 0.7;
  });
  const [freeform, setFreeform] = useState(() => localStorage.getItem("lr_freeform") || "");

  useEffect(() => localStorage.setItem("lr_showSettings", String(showSettings)), [showSettings]);
  useEffect(() => localStorage.setItem("lr_metaphors", String(wantMetaphors)), [wantMetaphors]);
  useEffect(() => localStorage.setItem("lr_synonyms", String(wantSynonyms)), [wantSynonyms]);
  useEffect(() => localStorage.setItem("lr_rhymes", String(wantRhymes)), [wantRhymes]);
  useEffect(() => localStorage.setItem("lr_wildness", String(wildness)), [wildness]);
  useEffect(() => localStorage.setItem("lr_freeform", freeform), [freeform]);

  // --- Tekstit ---
  const [authorText, setAuthorText] = useState("");
  const [renkiText, setRenkiText] = useState("");

  // --- Historia sanoittajalle ---
  const [history, setHistory] = useState([""]);
  const [histIndex, setHistIndex] = useState(0);
  const canUndo = histIndex > 0;
  const canRedo = histIndex < history.length - 1;

  const setAuthorTextWithHistory = (next) => {
    setAuthorText(next);
    setHistory((h) => {
      const newArr = h.slice(0, histIndex + 1);
      newArr.push(next);
      return newArr;
    });
    setHistIndex((i) => i + 1);
  };

  const undo = () => {
    if (!canUndo) return;
    const i = histIndex - 1;
    setHistIndex(i);
    setAuthorText(history[i]);
  };
  const redo = () => {
    if (!canRedo) return;
    const i = histIndex + 1;
    setHistIndex(i);
    setAuthorText(history[i]);
  };

  // --- Tila ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // --- Ref ---
  const authorRef = useRef(null);

  // --- Layout ---
  const isWide = useMediaQuery("(min-width: 900px)");
  const layoutStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: isWide ? "1fr 1fr" : "1fr",
      gap: 12,
    }),
    [isWide]
  );

  // --- Promptin muodostus ---
  const getSelectionOrLastLine = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) return authorText.slice(start, end).trim();

    // viimeinen rivi ennen kursoria
    const before = authorText.slice(0, start);
    const lines = before.split("\n");
    return (lines[lines.length - 1] || "").trim();
  };

  const buildPrompt = (basis) => {
    let p = `Analysoi annettu teksti ja tee hyvin lyhyitä ehdotuksia, älä selitä mitään, älä käytä otsikoita äläkä listmerkkejä.\n`;
    p += `Teksti: """${basis}"""\n\n`;

    const wants = [];
    if (wantMetaphors) wants.push("kielikuvia (metaforia, vertauskuvia)");
    if (wantSynonyms) wants.push("synonyymejä ja vaihtoehtoisia ilmauksia");
    if (wantRhymes) wants.push("riimiehdotuksia ja loppusointivariaatioita");

    if (wants.length) p += `Sisällytä: ${wants.join(", ")}.\n`;
    if (freeform.trim()) p += `Lisäohje: ${freeform.trim()}\n`;

    p += `\nPalauta 1–8 kohtaa, yksi per rivi, ilman selittävää esipuhetta.\n`;
    return p;
  };

  const askSuggestions = async () => {
    const basis = getSelectionOrLastLine();
    if (!basis) {
      setError("Valitse tekstiä tai kirjoita rivi, josta haluat ehdotuksia.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const prompt = buildPrompt(basis);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          temperature: clamp01(wildness),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`API-virhe ${r.status}: ${t}`);
      }
      const data = await r.json();
      const content = (data?.content || "").trim();
      if (!content) throw new Error("Tyhjä vastaus.");
      const stamp = new Date().toLocaleString();
      setRenkiText((prev) => prev + `--- Ehdotukset (${stamp}) ---\n${content}\n\n`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // --- Render ---
  return (
    <div style={pageWrap}>
      {/* Sticky header with subtle bottom border */}
      <header style={headerWrap}>
        <div style={headerInner}>
          <div style={{ textAlign: "center" }}>
            <div style={titleStyle}>Lyriikkarenki</div>
            <div style={versionStyle}>v0.3</div>
          </div>
          <button
            onClick={() => setShowSettings((s) => !s)}
            title={showSettings ? "Piilota asetukset" : "Näytä asetukset"}
            style={iconButtonStyle}
            aria-label="Asetukset"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Settings card */}
      {showSettings && (
        <section style={card}>
          <div style={checksRow}>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantMetaphors}
                onChange={(e) => setWantMetaphors(e.target.checked)}
              />
              &nbsp;kielikuvia
            </label>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantSynonyms}
                onChange={(e) => setWantSynonyms(e.target.checked)}
              />
              &nbsp;synonyymejä
            </label>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={wantRhymes}
                onChange={(e) => setWantRhymes(e.target.checked)}
              />
              &nbsp;riimiehdotuksia
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
              Vapaamuotoinen ohje tekoälylle
            </label>
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              rows={3}
              placeholder="Esim. 'sävy melankolinen', 'vältä anglismeja', '8 tavua / rivi'..."
              style={{ ...textareaStyle, minHeight: 0, height: "auto" }} 
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 600 }}>
              Ehdotusten villiys: {wildness.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={wildness}
              onChange={(e) => setWildness(Number(e.target.value))}
              style={{ width: "100%", marginTop: 8 }}
              aria-label="Villiyden liukusäädin"
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button onClick={askSuggestions} disabled={loading} style={primaryBtn}>
              {loading ? "Haetaan..." : "Ehdota"}
            </button>
            <button onClick={() => { setAuthorText(""); setHistory([""]); setHistIndex(0); }} style={btnStyle}>
              tyhjennä sanoittajan ikkuna
            </button>
            <button onClick={undo} disabled={!canUndo} style={btnStyle}>
              peru muutos (sanoittajan ikkunassa)
            </button>
            <button onClick={redo} disabled={!canRedo} style={btnStyle}>
              tee muutos uudelleen (sanoittajan ikkunassa)
            </button>
            <button onClick={() => setRenkiText("")} style={btnStyle}>
              tyhjennä rengin ikkuna
            </button>
            <button onClick={() => setShowSettings(false)} style={btnStyle}>
              piilota asetukset
            </button>
          </div>

          {error && <div style={{ color: "#b00020", marginTop: 8 }}>{error}</div>}
        </section>
      )}

      {/* Two panes */}
      <section style={layoutStyle}>
        <div style={paneCard}>
          <label style={paneTitle}>Sanoittajan ikkuna</label>
          <textarea
            ref={authorRef}
            value={authorText}
            onChange={(e) => setAuthorTextWithHistory(e.target.value)}
            placeholder="Kirjoita tai liitä sanoitus tähän..."
            rows={20}
            style={textareaStyle}
          />
        </div>

        <div style={paneCard}>
          <label style={paneTitle}>Rengin ikkuna</label>
          <textarea
            value={renkiText}
            readOnly
            placeholder="Tähän kertyy kielikuvia, riimejä ja synonyymejä..."
            rows={20}
            style={{ ...textareaStyle, background: "#f7f7f7" }}
          />
        </div>
      </section>

      <footer style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, padding: "16px 0" }}>
        © {new Date().getFullYear()} Lyriikkarenki
      </footer>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
function lsBool(key, fallback) {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "true";
}
function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const handler = () => setMatch(m.matches);
    handler();
    m.addEventListener?.("change", handler);
    return () => m.removeEventListener?.("change", handler);
  }, [query]);
  return match;
}

/* ---------------- styles ---------------- */

const pageWrap = {
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  background: "linear-gradient(180deg,#fafafa, #ffffff)",
  minHeight: "100vh",
  padding: "0 16px",
};

const headerWrap = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  background: "rgba(255,255,255,0.9)",
  backdropFilter: "saturate(180%) blur(6px)",
  borderBottom: "1px solid #eee",
};

const headerInner = {
  maxWidth: 1200,
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "10px 0",
};

const titleStyle = {
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: 0.2,
  margin: 0,
  lineHeight: 1.05,
};

const versionStyle = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
};

const card = {
  maxWidth: 1200,
  margin: "12px auto",
  background: "white",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const checksRow = { display: "flex", flexWrap: "wrap", gap: 16 };

const paneCard = {
  background: "white",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const paneTitle = { fontWeight: 600, display: "block", marginBottom: 6 };

const textareaStyle = {
  width: "100%",
  minHeight: 320,
  resize: "vertical",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  outline: "none",
  background: "white",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  lineHeight: 1.4,
};

const checkStyle = { userSelect: "none" };

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
  transition: "transform .02s ease",
};
const primaryBtn = {
  ...btnStyle,
  background: "#111827",
  color: "white",
  borderColor: "#111827",
};
const iconButtonStyle = {
  ...btnStyle,
  width: 36,
  height: 36,
  borderRadius: 10,
  fontSize: 18,
  lineHeight: "18px",
  display: "grid",
  placeItems: "center",
  position: "absolute",
  right: 16,
};
