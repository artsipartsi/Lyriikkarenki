import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lyriikkarenki – v0.8 (täyskorkeus myös asetukset auki, täysleveä layout)
 */

export default function App() {
  // --- UI ---
  const [showSettings, setShowSettings] = useState(() => {
    const saved = localStorage.getItem("lr_showSettings");
    return saved ? saved === "true" : true;
  });

  // --- Kehittäjätila (backdoor) ---
  const qs = new URLSearchParams(window.location.search);
  const devParam = qs.get("dev"); // "1" | "0" | null
  const initialDev =
    devParam === "1"
      ? true
      : devParam === "0"
      ? false
      : localStorage.getItem("lr_dev") === "true";
  const [devMode, setDevMode] = useState(initialDev);
  useEffect(() => localStorage.setItem("lr_dev", String(devMode)), [devMode]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && (e.key === "d" || e.key === "D")) {
        setDevMode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // --- Layout (responsiivinen sarake/rinnakkain) ---
  const isWide = useMediaQuery("(min-width: 900px)");
  const layoutCols = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: isWide ? "1fr 1fr" : "1fr",
      gap: 12,
      alignItems: "stretch",
    }),
    [isWide]
  );

  // --- Promptin muodostus ---
  const [selTick, setSelTick] = useState(0);
  const bumpSel = () => setSelTick((t) => t + 1);

  const getSelectionOrCurrentLine = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) return authorText.slice(start, end).trim();

    const text = authorText;
    const caret = start;
    const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const nextNL = text.indexOf("\n", caret);
    const lineEnd = nextNL === -1 ? text.length : nextNL;
    return text.slice(lineStart, lineEnd).trim();
  };

  const buildPrompt = (basis) => {
    let p = `Teksti analysoitavaksi:\n"${basis}"\n\n`;
    const wants = [];
    if (wantMetaphors) wants.push("kielikuvia");
    if (wantSynonyms) wants.push("synonyymejä");
    if (wantRhymes) wants.push("riimiehdotuksia");
    if (wants.length) p += `Sisällytä: ${wants.join(", ")}.\n`;
    if (freeform.trim()) p += `Lisäohje: ${freeform.trim()}\n`;
    return p;
  };

  // Kehittäjätilan prompt-esikatselu
  const [promptPreview, setPromptPreview] = useState("");
  const refreshPromptPreview = () => {
    if (!devMode) return;
    const basis = getSelectionOrCurrentLine();
    setPromptPreview(buildPrompt(basis || "<ei valintaa / kursoririvi tyhjä>"));
  };
  useEffect(() => {
    refreshPromptPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devMode, authorText, wantMetaphors, wantSynonyms, wantRhymes, wildness, freeform, selTick]);

  const askSuggestions = async () => {
    const basis = getSelectionOrCurrentLine();
    if (!basis) {
      setError("Valitse tekstiä tai siirrä kursori riville, josta haluat ehdotuksia.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const prompt = buildPrompt(basis);
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: clamp01(wildness) }),
      });
      if (!r.ok) throw new Error(`API-virhe ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const content = (data?.content || "").trim();
      if (!content) throw new Error("Tyhjä vastaus.");
      setRenkiText((prev) => prev + `---------------\n${content}\n`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      refreshPromptPreview();
    }
  };

  // --- Korkeuden laskenta (aina lukittu paneelialue, myös asetukset auki) ---
  const headerRef = useRef(null);
  const settingsRef = useRef(null);
  const toolbarRef = useRef(null);
  const footerRef = useRef(null);
  const [paneAreaHeight, setPaneAreaHeight] = useState(null);

  const MIN_ROWS = 5;
  const ROW_PX = 22;
  const TEXTAREA_EXTRA = 24;
  const PANEL_EXTRA = 56;
  const MIN_TEXTAREA_PX = MIN_ROWS * ROW_PX + TEXTAREA_EXTRA;
  const MIN_PANEL_PX = MIN_TEXTAREA_PX + PANEL_EXTRA;

  const recalcPaneHeight = () => {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const hdr = headerRef.current?.getBoundingClientRect()?.height || 0;
    const set = settingsRef.current?.getBoundingClientRect()?.height || 0; // huomioi asetuskortin korkeus
    const tlb = toolbarRef.current?.getBoundingClientRect()?.height || 0;
    const ftr = footerRef.current?.getBoundingClientRect()?.height || 0;

    const chrome = 32 + 12 + 8; // hengitysvara & gap
    const available = Math.max(0, Math.floor(vh - hdr - set - tlb - ftr - chrome));

    // AINA aseta lukituskorkeus — myös asetukset auki
    setPaneAreaHeight(available);
  };

  useEffect(() => {
    recalcPaneHeight();
    const onResize = () => recalcPaneHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, isWide]);

  // --- Render ---
  return (
    <div style={pageWrap}>
      {/* Sticky header */}
      <header ref={headerRef} style={headerWrap}>
        <div style={headerInner}>
          <div /> {/* vasen täytesarake 40px */}

          <div style={titleRowCentered}>
            <div style={titleStyle}>Lyriikkarenki</div>
            <div style={versionInline}>v0.8</div>
          </div>

          <button
            onClick={(e) => {
              setShowSettings((s) => !s);
              e.currentTarget.blur(); // poista focus-kehys klikin jälkeen
            }}
            title={showSettings ? "Piilota asetukset" : "Näytä asetukset"}
            style={gearBtn}
            aria-label="Asetukset"
          >
            <span style={gearGlyph}>⚙</span>
          </button>
        </div>
      </header>

      {/* Settings card */}
      {showSettings && (
        <section ref={settingsRef} style={card}>
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
              style={{ ...baseTextarea, minHeight: 0, height: "auto" }}
            />
          </div>

          {devMode && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={devBadge}>DEV</span>
                <strong>AI-prompt (esikatselu)</strong>
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  (päivittyy valinnan/kurssorin ja asetusten mukaan)
                </span>
              </div>
              <textarea
                readOnly
                value={promptPreview}
                rows={8}
                style={{ ...baseTextarea, minHeight: 0, height: "auto", background: "#fcfcff" }}
              />
            </div>
          )}

          <div style={{ marginTop: 12, paddingRight: 6 }}>
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
  style={rangeFull}
  aria-label="Villiyden liukusäädin"
/>
          </div>

          {error && <div style={{ color: "#b00020", marginTop: 8 }}>{error}</div>}
        </section>
      )}

      {/* ALWAYS-VISIBLE ACTION BAR */}
      <section ref={toolbarRef} style={toolbarCard}>
        <button onClick={askSuggestions} disabled={loading} style={primaryBtn}>
          {loading ? "Haetaan..." : "Ehdota"}
        </button>
        <span style={{ color: "#6b7280", fontSize: 12 }}>
          Vihje: Käytetään valittua tekstiä tai jos mitään ei ole valittu, niin käytetään kursorin riviä.
        </span>
      </section>

      {/* Two panes — aina lukittu korkeus (paneAreaHeight) */}
      <section
        style={{
          ...layoutCols,
          height: paneAreaHeight ?? "auto",
          overflow: "hidden",
        }}
      >
        <div style={paneCardFlex}>
          <label style={paneTitle}>Sanoitus</label>
          <textarea
            ref={authorRef}
            value={authorText}
            onChange={(e) => {
              setAuthorTextWithHistory(e.target.value);
              bumpSel();
            }}
            onSelect={bumpSel}
            onKeyUp={bumpSel}
            onMouseUp={bumpSel}
            onFocus={bumpSel}
            onBlur={bumpSel}
            placeholder="Kirjoita tai liitä sanoitus tähän..."
            style={textareaFill(MIN_TEXTAREA_PX)}
          />
        </div>

        <div style={paneCardFlex}>
          <div style={paneHeaderRow}>
            <label style={{ ...paneTitle, marginBottom: 0 }}>Ehdotukset</label>
            <button
              onClick={() => setRenkiText("")}
              style={smallGhostBtn}
              title="Tyhjennä ehdotukset"
              aria-label="Tyhjennä ehdotukset"
            >
              Tyhjennä
            </button>
          </div>

          <textarea
            value={renkiText}
            readOnly
            placeholder="Tähän kertyy kielikuvia, riimejä ja synonyymejä..."
            style={{ ...textareaFill(MIN_TEXTAREA_PX), background: "#f7f7f7" }}
          />
        </div>
      </section>

      <footer
        ref={footerRef}
        style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, padding: "16px 0" }}
      >
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
  padding: 0,             // ennen: "0 16px"
  width: "100vw",         // täysi näkymäleveys
  overflowX: "hidden",    // ettei tule vaakarullaa marginaalien takia
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
  maxWidth: "none",
  margin: 0,
  display: "grid",
  gridTemplateColumns: "40px 1fr 56px", // ennen: "40px 1fr 40px"
  alignItems: "center",
  padding: "10px 12px",
};

const card = {
  width: "100%",
  maxWidth: "none",
  margin: "12px 0",
  background: "white",
  border: "1px solid #eee",
  borderRadius: 0,        // ennen: 12 — nyt kortti “bleedaa” reunoihin
  padding: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const toolbarCard = {
  ...card,
  display: "flex",
  alignItems: "center",
  gap: 12,
  paddingTop: 10,
  paddingBottom: 10,
};

const checksRow = { display: "flex", flexWrap: "wrap", gap: 16 };

const paneCard = {
  background: "white",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const paneCardFlex = {
  ...paneCard,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  height: "100%", // venyy aina varattuun paneelialueeseen
};

const paneTitle = { fontWeight: 600, display: "block", marginBottom: 6 };

const baseTextarea = {
  width: "100%",
  resize: "none",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  outline: "none",
  background: "white",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  lineHeight: 1.4,
};

const textareaFill = (minPx) => ({
  ...baseTextarea,
  flex: 1,
  minHeight: minPx, // vähintään 5 riviä, venyy tarpeen mukaan
});

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

const gearBtn = {
  width: 32,            // ennen 40
  height: 32,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#111827",
  display: "grid",
  placeItems: "center",
  justifySelf: "end",   // pysyy oikeassa laidassa
  cursor: "pointer",
};

const gearGlyph = {
  fontSize: 20,
  lineHeight: 1,
  display: "block",
};

const devBadge = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 6,
  fontSize: 11,
  background: "#eef2ff",
  color: "#3730a3",
  border: "1px solid #c7d2fe",
};

const titleRowCentered = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  justifySelf: "center", // keskittää solussa
  width: "max-content",
  textAlign: "center",
};

const titleStyle = {
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: 0.2,
  margin: 0,
  lineHeight: 1.05,
};

const versionInline = {
  fontSize: 14,
  color: "#6b7280",
  lineHeight: 1,
};

const paneHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6,
};

const smallGhostBtn = {
  ...btnStyle,
  padding: "6px 10px",
  background: "transparent",
  borderColor: "#e5e7eb",
};

const rangeFull = {
  width: "100%",
  boxSizing: "border-box",   // <-- ei ylitä konttia
  marginTop: 8,
  paddingInline: 0,
};

