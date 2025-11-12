import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lyriikkarenki – v0.32 (Help-overlay + auto-scroll Ehdotukset + MET/SYN/RHY always on)
 */

export default function App() {
  // --- UI ---
  const [showSettings, setShowSettings] = useState(() => {
    const saved = localStorage.getItem("lr_showSettings");
    return saved ? saved === "true" : true;
  });
  const [showHelp, setShowHelp] = useState(false); // käyttöohje-ikkuna

  // --- Kehittäjätila (backdoor) ---
  const qs = new URLSearchParams(window.location.search);
  const devParam = qs.get("dev");
  const initialDev =
    devParam === "1" ? true : devParam === "0" ? false : localStorage.getItem("lr_dev") === "true";
  const [devMode, setDevMode] = useState(initialDev);
  // --- DEV/prompt-esikatselua varten ---
const [lastPromptBasis, setLastPromptBasis] = useState("");

  useEffect(() => localStorage.setItem("lr_dev", String(devMode)), [devMode]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.altKey && (e.key === "d" || e.key === "D")) setDevMode((v) => !v);
      if (e.key === "Escape") setShowHelp(false); // Esc sulkee ohjeen
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Valinnat (persist) ---
  // Kielikuvat, synonyymit ja riimit ovat tästä versiosta alkaen AINA päällä → ei checkboxeja
  const [wildness, setWildness] = useState(() => {
    const s = localStorage.getItem("lr_wildness");
    return s ? Number(s) : 0.7;
  });
  const [freeform, setFreeform] = useState(() => localStorage.getItem("lr_freeform") || "");

  useEffect(() => localStorage.setItem("lr_showSettings", String(showSettings)), [showSettings]);
  useEffect(() => localStorage.setItem("lr_wildness", String(wildness)), [wildness]);
  useEffect(() => localStorage.setItem("lr_freeform", freeform), [freeform]);

  const [autoSuggest, setAutoSuggest] = useState(() => {
    const s = localStorage.getItem("lr_autoSuggest");
    return s === null ? true : s === "true";
  });
  useEffect(() => localStorage.setItem("lr_autoSuggest", String(autoSuggest)), [autoSuggest]);

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
  const renkiRef = useRef(null); // auto-scroll

  // Muistaa viimeisimmän "taukoautohaku (pause)" -rivin ja ajan
  const lastPauseRef = useRef({ line: "", at: 0 });

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
    if (start !== end) return authorText.slice(start, end);
    return getLineAt(authorText, end);
  };

  // Palauta valinnan teksti tai tyhjä
  const getSelectedText = () => {
    const el = authorRef.current;
    if (!el) return "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return start !== end ? authorText.slice(start, end) : "";
  };

  // Onko valintaa?
  const hasSelection = () => {
    const el = authorRef.current;
    if (!el) return false;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return end > start;
  };

  const buildPrompt = (basis) => {
    let p = `Teksti analysoitavaksi:\n"${basis}"\n\n`;
    const wants = [];
    // AINA päällä
    wants.push("kielikuvia", "synonyymejä", "riimiehdotuksia");
    if (wants.length) p += `Sisällytä: ${wants.join(", ")}.\n`;
    if (freeform.trim()) p += `Lisäohje: ${freeform.trim()}\n`;
    return p;
  };

  // Kehittäjätilan prompt-esikatselu
  const [promptPreview, setPromptPreview] = useState("");
  const refreshPromptPreview = (basisArg, mode = "smart") => {
    if (!devMode) return;
    const basis = basisArg ?? getSelectionOrCurrentLine();
    const builder = mode === "selected" ? buildPromptSelected : buildPromptSmart;
    setPromptPreview(builder(basis || "<ei valintaa / kursoririvi tyhjä>"));
  };
  useEffect(() => {
    refreshPromptPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devMode, authorText, wildness, freeform, selTick]);

  const getCurrentLineText = () => getSelectionOrCurrentLine();

  const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  const lastWord = (s) => (s.trim() ? s.trim().split(/\s+/).pop() : "");

  const buildPromptSmart = (line) => {
    const txt = line ?? "";
    const wc = wordCount(txt.trim());
    const lw = lastWord(txt.trim());
    let p = `Teksti analysoitavaksi:\n"${txt}"\n`;
    if (wc >= 1 && lw) {
      p += `Etsi kontekstiin sopivia, mutta monipuolisia synonyymejä sanalle: "${lw}". Mukana saa olla sekä arkisia että runollisia vaihtoehtoja, mutta vältä keinotekoisia tai olemattomia sanoja.\n`;
      p += `Ehdota lisäksi sopivia riimejä sanalle "${lw}" – vain olemassa olevia suomen sanoja.\n`;
    }
    if (wc >= 2) {
      p += `Keksi tuoreita ja omaperäisiä kielikuvia koko tekstistä, vältä kliseisiä rakkaus- tai tuli-vertauskuvia. Kielikuvat voivat olla myös arkipäiväisiä, humoristisia, yllättäviä, visuaalisia ja jopa surrealistisia, kunhan ne tukevat tekstin tunnetta.\n`;
      p += `Ehdota myös muita kirjoittamisen tehokeinoja (esim. toisto, kontrasti, rytmi, odotuksen rikkominen, sanaleikki).`;
    }
    if (freeform.trim()) p += `\nLisäohje: ${freeform.trim()}\n`;
    return p;
  };

  const askSmartSuggestions = async (line, reason = "auto") => {
    const sig = `${reason}|${line.trim()}`;
    if (!line.trim() || sig === lastAutoSig) return; // estä duplikaatit
    setLastAutoSig(sig);

    if (reason === "pause") {
      lastPauseRef.current = { line: (line || "").trim(), at: Date.now() };
    }

    setError("");
    setLoading(true);
    try {
      const prompt = buildPromptSmart(line);
      setLastPromptBasis(line);              // talteen mahdollisia dev-käyttöjä varten
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 1.0 }), // villiys aina maksimi
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
      // Näytä esikatselussa TÄSMÄLLEEN sama rivi, joka lähetettiin API:lle
      refreshPromptPreview?.(line);
    }
  };

  const askSuggestions = async () => {
    setError("");
    setLoading(true);

    // 1) Jos on valinta → käytä sitä (nykyinen logiikka)
    const sel = getSelectedText();
    let prompt = "";
    try {
      if (sel && sel.trim()) {
        prompt = `Etsi kontekstiin sopivia, mutta monipuolisia synonyymejä sanalle: "${sel}". Mukana saa olla sekä arkisia että runollisia vaihtoehtoja, mutta vältä keinotekoisia tai olemattomia sanoja.\n`;
        prompt += `Ehdota lisäksi sopivia riimejä sanalle "${sel}" – vain olemassa olevia suomen sanoja.\n`;
        prompt = `Keksi tuoreita ja omaperäisiä riimejä, synonyymejä ja kielikuvia valitusta tekstistä:\n"${sel}"\nVältä kliseisiä rakkaus- tai tuli-vertauskuvia. Kielikuvat voivat olla myös arkipäiväisiä, humoristisia, yllättäviä, visuaalisia ja jopa surrealistisia, kunhan ne tukevat tekstin tunnetta.\n`;
        prompt += `Ehdota myös muita kirjoittamisen tehokeinoja (esim. toisto, kontrasti, rytmi, odotuksen rikkominen, sanaleikki).`;

        if (freeform.trim()) prompt += `\nLisäohje: ${freeform.trim()}\n`;
      } else {
        // 2) Muuten käytä KURSORIRIVIÄ kuten automaattihaussa
        const basis = getSelectionOrCurrentLine()?.trim() || "";
        if (!basis) {
          setLoading(false);
          setError("Kirjoita riville tekstiä tai valitse jokin jakso.");
          return;
        }
        prompt = buildPromptSmart(basis);
        // dev-esikatseluun talteen täsmälleen sama rivi
        setLastPromptBasis(basis);
      }

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 1.0 }),
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
      if (devMode) setPromptPreview(prompt);
    }
  };

  // --- Auto-scroll Ehdotukset-ikkunaan ---
  useEffect(() => {
    const el = renkiRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [renkiText]);

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
    const set = settingsRef.current?.getBoundingClientRect()?.height || 0;
    const tlb = toolbarRef.current?.getBoundingClientRect()?.height || 0;
    const ftr = footerRef.current?.getBoundingClientRect()?.height || 0;

    const chrome = 32 + 12 + 8;
    const available = Math.max(0, Math.floor(vh - hdr - set - tlb - ftr - chrome));
    setPaneAreaHeight(available);
  };

  // --- Autohaku ---
  const typingTimerRef = useRef(null);
  const AUTO_DELAY_MS = 2300; // ~2–3 s tauko
  const [lastAutoSig, setLastAutoSig] = useState("");


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
          <div /> {/* vasen täytesarake */}

          <div style={titleRowCentered}>
            <div style={titleStyle}>Lyriikkarenki</div>
            <div style={versionInline}>v0.32 (gpt-4.1)</div>
          </div>

          {/* ?-nappi */}
          <button
            onClick={() => setShowHelp(true)}
            title="Näytä käyttöohje"
            style={iconBtn}
            aria-label="Käyttöohje"
          >
            <span style={iconGlyph}>?</span>
          </button>

          {/* Asetukset-nappi */}
          <button
            onClick={(e) => {
              setShowSettings((s) => !s);
              e.currentTarget.blur();
            }}
            title={showSettings ? "Piilota asetukset" : "Näytä asetukset"}
            style={iconBtn}
            aria-label="Asetukset"
          >
            <span style={iconGlyph}>⚙</span>
          </button>
        </div>
      </header>

      {/* Settings card */}
      {showSettings && (
        <section ref={settingsRef} style={card}>
          {/* Checkboxit poistettu – MET/SYN/RHY aina päällä */}
          <div style={{ marginTop: 0, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoSuggest}
                onChange={(e) => setAutoSuggest(e.target.checked)}
              />
              <span>Automaattiset ehdotukset</span>
            </label>
            <div style={{ color: "#6b7280", fontSize: 12, marginLeft: 2 }}>
              Kun tämä on päällä, Lyriikkarenki hakee ehdotuksia tauon ja Enterin jälkeen.
            </div>
          </div>

          <div style={{ marginTop: 0 }}>
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

          {error && <div style={{ color: "#b00020", marginTop: 8 }}>{error}</div>}
        </section>
      )}

      {/* Action bar */}
      <section ref={toolbarRef} style={toolbarWrap}>
        {/* Manuaalinen Ehdota (vain valinnasta) */}
        <button
          onClick={askSuggestions}
          disabled={loading}
          style={{
            ...primaryBtn,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}

        >
        Ehdota (valinta tai nykyrivi)
        </button>

        {/* Automaattisen haun indikaattori (näkyy myös kun nappia ei paineta) */}
        {loading && (
          <div style={loadingIndicator}>
            Haetaan...
          </div>
        )}

        <span style={{ color: "#6b7280", fontSize: 12 }}>
          Vihje: Haku tehdään valinnasta tai nykyiseltä riviltä
        </span>
      </section>

      {/* Two panes */}
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
              lastPauseRef.current = { line: "", at: 0 };
              const textNow = e.target.value;
              setAuthorTextWithHistory(textNow);
              bumpSel();

              // Käytä UUTTA arvoa ja caretia -> ei katoa viimeinen merkki
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              const caret = e.target.selectionEnd ?? textNow.length;
              const line = getLineAt(textNow, caret);
              const lw = lastWord(line);
              if (autoSuggest && lw && lw.length >= 4) {
                typingTimerRef.current = setTimeout(() => {
                  askSmartSuggestions(line.trim(), "pause");
                }, AUTO_DELAY_MS);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const caret = e.currentTarget.selectionEnd ?? authorText.length;
                const lineBeforeBreak = getLineAt(authorText, caret);
                const lineTrim = (lineBeforeBreak || "").trim();

                // EI automaattihakua, jos asetus pois päältä
                if (!autoSuggest) {
                  return; // pelkkä rivinvaihto, ei hakua
                }

                // Estä enter-haku, jos samasta rivistä tehtiin juuri "pause"-autohaku
                const { line, at } = lastPauseRef.current || {};
                const RECENT_MS = 60_000;
                const justPausedSameLine =
                  line && line === lineTrim && Date.now() - at < RECENT_MS;

                if (justPausedSameLine) {
                  return; // ei hakua
                }

                // Muuten tee normaali enter-haku (välitön)
                setTimeout(() => askSmartSuggestions(lineBeforeBreak, "enter"), 0);
              }
            }}
            onBlur={() => {
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              bumpSel();
            }}

            onSelect={bumpSel}
            onKeyUp={bumpSel}
            onMouseUp={bumpSel}
            onFocus={bumpSel}
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
            ref={renkiRef}
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

      {/* --- HELP OVERLAY (koko ikkunan kokoinen) --- */}
      {showHelp && (
        <div role="dialog" aria-modal="true" style={helpOverlay}>
          <div style={helpInner}>
            <button
              onClick={() => setShowHelp(false)}
              aria-label="Sulje ohje"
              title="Sulje"
              style={helpCloseBtn}
            >
              ✕
            </button>

            <h1 style={{ marginTop: 0, marginBottom: 8 }}>Lyriikkarenki – käyttöohje</h1>
            <p style={{ marginTop: 0, color: "#6b7280" }}>
              Lyriikkarenki auttaa sanoittajaa tuottamaan <strong>synonyymejä</strong>,
              <strong> riimiehdotuksia</strong> ja <strong>kielikuvia</strong> kirjoittamasi tekstin pohjalta.
            </p>

            <h2>1. Peruskäyttö</h2>
            <ol>
              <li>
                Kirjoita tai liitä teksti <strong>Sanoitus</strong>-kenttään vasemmalla.
              </li>
              <li>
                Odota hetki: jos olet kirjoittanut vähintään nelikirjaimisen sanan ja et kirjoita n. <strong>3 sekuntiin</strong>, tekoäly hakee automaattisesti ehdotuksia. Haun aikana näkyy keltapohjainen "Haetaan.."-indikaattori, mutta tekstiä voi kirjoittaa silloinkin. Riimiehdotukset ja synonyymit liittyvät rivin viimeiseen sanaan, kielikuvat koko riviin. Rivillä on oltava vähintään kaksi sanaa, jotta kielikuvia haettaisiin.
              </li>
              <li>
                Myös rivinvaihto tekee ehdotuksia samalla systeemillä.
              </li>
              <li>
                Ehdotukset ilmestyvät oikeanpuoleiseen <strong>Ehdotukset</strong>-ikkunaan ja skrollaavat automaattisesti näkyviin.
              </li>
              <li>
                Voit myös valita tekstiä ja painaa <strong>Ehdota (valinta tai rivi)</strong> -painiketta. Tällöin riimiehdotukset, synonyymit ja kielikuvat liittyvät koko valittuun tekstiin.
                Jos mitään ei ole valittuna, käsitellään kursorin rivin sisältö kuten automaattihaussa.
              </li>
              <li>
                Asetuksista voit kytkeä <strong>Automaattiset ehdotukset</strong> pois päältä.
                Tällöin ehdotukset tulevat vain nappia painamalla.
              </li>
            </ol>

            <h2>2. Asetukset ⚙</h2>
            <ul>
              <li>
                Avaa asetukset oikean yläkulman <strong>⚙</strong>-painikkeesta.
              </li>
              <li>
                Kun <strong>Automaattiset ehdotukset</strong> on päällä, tehdään automaattisia ehdotuksia 3s viiveellä ja rivinvaihdon jälkeen.
              </li>
              <li>
                Kirjoita halutessasi <strong>vapaamuotoinen ohje tekoälylle</strong> — esim.:
                <em> “sävy melankolinen”, “vältä anglismeja”, “8 tavua per rivi”</em>.
              </li>
            </ul>

            <h2>3. Ehdotusten hallinta</h2>
            <ul>
              <li>
                Ehdotukset näkyvät aikajärjestyksessä, ja jokaisen haun väliin tulee katkoviiva.
              </li>
              <li>
                Paina “<strong>Tyhjennä</strong>” poistaaksesi kaikki ehdotukset.
              </li>
              <li>
                Kopioi ehdotuksia tekstieditoriin valitsemalla ja liittämällä manuaalisesti.
              </li>
            </ul>

            <h2>4. Vinkkejä ja pikanäppäimiä</h2>
            <ul>
              <li><kbd>Ctrl + Z</kbd> tai <kbd>Cmd + Z</kbd> – Peruuta viimeisin muutos</li>
              <li><kbd>Ctrl + Y</kbd> tai <kbd>Cmd + Shift + Z</kbd> – Tee uudestaan</li>
              <li><kbd>Ctrl + C</kbd> tai <kbd>Cmd + C</kbd> – Kopioi valittu teksti leikepöydälle</li>
              <li><kbd>Ctrl + V</kbd> tai <kbd>Cmd + V</kbd> – Liitä valittu teksti leikepöydältä</li>
              <li><kbd>Esc</kbd> tai – Sulje tämä ohje</li>
            </ul>

            <h2>5. Automaattihaku ja yksityisyys</h2>
            <p>
              Lyriikkarenki lähettää tekoälylle vain sen rivin, jossa kursori on tai josta olet tehnyt valinnan.
              Tekstejä ei tallenneta pysyvästi mihinkään.
            </p>

            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 24 }}>
              Sulje ohje painamalla ✕ tai Esc.
            </p>
          </div>
        </div>
      )}
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

// Palauta kursorin rivin raakateksti annetusta tekstistä ja caretista
const getLineAt = (text, caretEnd) => {
  const caret = typeof caretEnd === "number" ? caretEnd : text.length;
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nextNL = text.indexOf("\n", caret);
  const lineEnd = nextNL === -1 ? text.length : nextNL;
  return text.slice(lineStart, lineEnd); // ei trimmiä
};

// EHDOTA-nappulan builderi
const buildPromptSelected = (sel) => {
  let p = `Keksi synonyymejä, riimiehdotuksia ja kielikuvia valitusta tekstistä:\n"${sel}"\n`;
  if (freeform.trim()) p += `\nLisäohje: ${freeform.trim()}\n`;
  return p;
};

/* ---------------- styles ---------------- */

const pageWrap = {
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  background: "linear-gradient(180deg,#fafafa, #ffffff)",
  minHeight: "100vh",
  padding: 0,
  width: "100vw",
  overflowX: "hidden",
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
  gridTemplateColumns: "40px 1fr 40px 40px", // vasen täyte | otsikko | ? | ⚙
  alignItems: "center",
  padding: "10px 12px",
  columnGap: 8,
};

const card = {
  width: "100%",
  maxWidth: "none",
  margin: "12px 0",
  background: "white",
  border: "1px solid #eee",
  borderRadius: 0,
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
  flexWrap: "wrap",
};

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
  height: "100%",
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
  minHeight: minPx,
});

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

// näkyvä harmaa versio (kun ei valintaa)
const disabledBtn = {
  ...btnStyle,
  background: "#e5e7eb",
  color: "#6b7280",
  borderColor: "#d1d5db",
  cursor: "default",
};

const loadingBtn = {
  ...primaryBtn,
  background: "#d97706", // kirkas oranssi / keltainen
  borderColor: "#d97706",
  cursor: "wait",
  transition: "background 0.2s ease",
};

const iconBtn = {
  width: 32,
  height: 32,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#111827",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const iconGlyph = { fontSize: 20, lineHeight: 1, display: "block" };

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
  justifySelf: "center",
  width: "max-content",
  textAlign: "center",
};

const titleStyle = {
  fontSize: 24,
  fontWeight: 900,
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
  width: "95%",
  boxSizing: "border-box",
  marginTop: 8,
  marginRight: 8,
  paddingInline: 0,
};

// Haun erillinen indikaattori (näkyy vain loading === true)
const loadingIndicator = {
  padding: "8px 14px",
  borderRadius: 10,
  background: "#d97706",
  color: "white",
  fontWeight: 700,
  boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
};

// Toolbarin oma wrap (käyttää card-tyyliä pohjana)
const toolbarWrap = {
  ...toolbarCard,
  display: "flex",
  alignItems: "center",
  gap: 12,
};

/* -------- HELP OVERLAY styles -------- */

const helpOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(2px)",
  display: "grid",
  placeItems: "center",
};

const helpInner = {
  width: "min(920px, 92vw)",
  height: "min(86vh, 960px)",
  background: "white",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  padding: 20,
  boxSizing: "border-box",
  overflow: "auto",
  position: "relative",
};

const helpCloseBtn = {
  position: "absolute",
  top: 10,
  right: 10,
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: "18px",
};
