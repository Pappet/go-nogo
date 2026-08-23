# 🚀 GO/NOGO – Spielkonzept v4 (Design-Freeze)

**Arbeitstitel:** *GO/NOGO* (Markenrecherche vor Phase 2, dann festnageln)

> **Designleitsatz:** *Wiederspielwert entsteht aus Entscheidungsraum, nicht aus Würfeln.*
> **Axiome:** *Pause stoppt die Simulation, nie die Kosten. Jeder Würfelwurf ist adressierbar. Der Kontrollraum arbeitet parallel – die Diagnose ist ein Sequencing-Rätsel, kein Menü.*
>
> **Status: Design-Freeze.** Änderungen an diesem Dokument ab jetzt nur noch aus Playtest-Evidenz (Phase-1-Replay-Test), nicht aus weiteren Review-Runden – der Grenznutzen weiterer Iterationen ist erreicht.

---

## 0. Änderungshistorie

**v1 → v2** (Kurzfassung): Ursachen-Graph statt Fehlertabelle · Risikobudget mit Preisschild · Doktrinen, Märkte, exklusive Tech-Gabelungen · Gegenskalierung (Fleet, Lichtlaufzeit, Policies) · Determinismus-Spezifikation ab Phase 0.

**v2 → v3** (Einarbeitung des Ox-Alpha-Reviews + zwei eigene Ergänzungen):

| # | Review-Punkt | Antwort in v3 | Abschnitt |
|---|---|---|---|
| 1 | Pausen-Paradoxon | **Pause als Schwierigkeitsachse**: Pause stoppt die Sim, aber Maßnahmen kosten Sim-Zeit – Pause = Denken, Handeln = Zeit | §5.7 |
| 2 | Langzeit-Flachung der Diagnose | Kontextabhängige Kandidaten-Priors, variierende Symptomstärken, **getimte Mechanik-Freischaltung** gegen Graph-Müdigkeit | §5.8 |
| 3 | Retry = gleicher Crash | Zwei explizite Wege nach Verlust: „Gleicher Seed" (Lernen) / „Neue Konfiguration" (Loop) – dank Punkt 4 würfeln **nur geänderte Teile** neu | §5.4 |
| 4 | RNG-Architektur | **Counter-/hash-basierte Draws** für alles Konfigurationsgebundene; sequentielle Streams nur für echte Ereignisfolgen. Macht Was-wäre-wenn exakt | §8.2 |
| 5 | Undefinierte Randsysteme | Personal minimal spezifiziert, Bankrott als Soft-Fail, Mid-Mission-Save verbindlich, **Hotkey-Schema ab Phase 1** | §6.5, §6.6, §7.7, §8.2 |
| 6 | Policy-Editor-UX | Visueller Chip-Editor + Vorlagenbibliothek, Textmodus nur als Expertenansicht | §5.6 |
| 7 | Graph braucht Tooling | **Linting des Ursachen-Graphen in CI** (4 Regeln + Zeitfenster-Check) | §8.4 |
| 8 | Phase 3 überladen | Gesplittet in **3a** (Lichtlaufzeit + Policies) und **3b** (Fleet + Infrastruktur) | §9 |
| 9 | Ökonomie-Degeneration | Vertragsboard-Mindestgarantie + Balancing-Kennzahl „Marktnutzung pro Kampagne" | §6.2 |
| + | *(eigene Ergänzung)* Daily-Challenge-Wertung fehlte | **Zeitunabhängige Wertung** (Profit → Präzision → Restrisiko): belohnt Risikomanagement, entschärft das Pause-Problem im Leaderboard | §6.8 |
| + | *(Review §3)* Modding & Sandbox ungenutzt | Modding als explizites Feature (Datenarchitektur schenkt es), Sandbox-Modus nach erstem Meilenstein | §8.5, §6.7 |
| + | *(Review §4)* Replay-Robustheit | Versions-Pinning (Game + Daten), Zustands-Hash alle 600 Ticks zur Desync-Lokalisierung | §8.2 |

**v3 → v4** (finales Review – Spezifikationslücken an den Systemgrenzen geschlossen):

| # | Befund | Antwort in v4 | Abschnitt |
|---|---|---|---|
| 1 | Aktions-Concurrency undefiniert (größter Hebel) | **Ressourcen-Modell**: Aktionen belegen Ressourcen für ihre Dauer, konfliktfreie Aktionen laufen **parallel** – Diagnose ist ein Sequencing-Rätsel unter Ressourcenknappheit | §5.2 |
| 2 | Linter-Regel 4 bei Parallelität falsch formuliert | Prüft jetzt den **kritischen Pfad (Makespan)** unter Ressourcenbeschränkung statt der Summe | §8.4 |
| 3 | Pause-Queue mehrdeutig; Ergebnis-Autopause und „kritische Phase" undefiniert | **Unbegrenztes Queuing** + Command-Timeline-Vorschau; „RESULT READY"-Softpause; Phasen-Flag in den Missionsdaten | §5.7 |
| 4 | Daily: Tiebreaker widerspricht der These, Verlierer unsichtbar, Server fehlt | Tiebreaker 2 = **geringste Startmasse**; gecrashte Runs stehen im Board; Leaderboard-Backend als Arbeitspaket in 3b | §6.8, §9 |
| 5 | Hash-Praxis: Float-Serialisierung, hash64-Primitiv offen | Kanonische **Binärcodierung** (DataView, LE) statt JSON.stringify; hash64 als 2×32-Lane-Mixing mit gepinnten Testvektoren | §8.2 |
| 6 | Müdigkeits-Tabelle hängt am Missionszähler | Freischaltung an **Kampagnen-Meilensteinen** – Komplexität kommt mit Fähigkeit, nicht mit Kalender | §5.8 |
| 7 | Randpunkte: Tutorial, i18n, Q/W/E-Bindung, Freeze×Gabelung, Investor-Verträge | Tutorial + i18n-Entscheidung in Phase 2 verortet; stabile Maßnahmen-Sortierung; Freeze- und Diktat-Regeln präzisiert | §6.6, §7.7, §9 |
| + | *(Review-Bonus)* Seriennummern-Lore | Teile-Historie im Post-Mortem sichtbar – „Ventil #4731 war schon in Mission 3 auffällig" | §7 |

---

## 1. Vision & Pitch

> **"Du bist der Flight Director eines kleinen Raumfahrt-Startups. Vom ersten schlingernden Feststoff-Flugkörper bis zum autonomen Sondennetzwerk im Sonnensystem – jede Mission läuft live über DEINE Konsole. Und jedes Risiko, das eintritt, hast du vorher gesehen und bewusst getragen."**

| Aspekt | Beschreibung |
|---|---|
| **Genre** | Simulations-/Management-Hybrid ("Reverse Kerbal": nicht bauen & fliegen, sondern steuern & entscheiden) |
| **Plattform** | Web-App (Desktop-fokussiert), später Tauri/Electron für Steam |
| **Spielerrolle** | Flight Director + Startup-CEO in einer Person |
| **Kerngefühl** | Spannung durch Verantwortung: Telemetrie lesen, Ursachen eingrenzen, unter Druck entscheiden – mit Risiken, die man selbst eingekauft hat |
| **Sessionlänge** | 10–40 Min pro Mission; Kampagne über viele Stunden; Sandbox danach |
| **Wiederspielwert** | Doktrinen × Szenarien × Tech-Gabelungen als strategischer Raum; Seeded Runs, Daily Challenge, Ghost-Replays, Modding |

**Design-Grundsätze:**
1. Der Spieler *steuert*, aber *fliegt nicht selbst*. Raketen folgen Programmen – die Kunst liegt in Planung und Umgang mit dem Unerwarteten.
2. *Keine Würfel ohne Preisschild.* Jede Zufallskomponente ist entweder vom Spieler gekauft (billige Teile, kein Test, keine Redundanz) oder im Briefing angekündigt (Sonnensturm-Prognose).
3. *(neu)* *Pause ist Denkzeit, nicht Handlungszeit.* Jede Maßnahme kostet Sim-Sekunden – Anhalten verschiebt Entscheidungen, es ersetzt sie nicht.

---

## 2. Kern-Gameplay-Loop

```
┌──────────────────────────────────────────────────────────────┐
│  0. DOKTRIN       (einmal pro Kampagne) Startup-Profil wählen │
│      ↓                                                        │
│  1. BÜRO          Vertragsboard (3 Märkte), Budget, Personal, │
│      ↓            Reputation                                  │
│  2. MISSIONSPLANUNG  Träger konfigurieren, QA-Stufe wählen,   │
│      ↓               Redundanz vs. Masse, RISIKOBUDGET lesen  │
│  3. PRELAUNCH     Checklisten, GO/NOGO-Poll, Countdown        │
│      ↓                                                        │
│  4. LIVE-BETRIEB  ◄── Herzstück: Symptome lesen, DIAGNOSE     │
│      │               bezahlen oder blind handeln, Manöver     │
│      │               freigeben, Time Warp in Ruhephasen       │
│      ↓                                                        │
│  5. AUSWERTUNG    Post-Mortem mit Replay: "Risiko 9 % akzep-  │
│      ↓               tiert – eingetreten: Gimbal-Lager"       │
│      ↓            → Retry: gleicher Seed ODER neue Config     │
│  6. WACHSTUM      Geld/Daten investieren, GABELUNG wählen,    │
│      └────────────► Markt-Reputation ausbauen                 │
└──────────────────────────────────────────────────────────────┘
```

**Spannungsbogen pro Mission:** Ruhige Planung → Adrenalin beim Start → Time Warp als Rhythmusgeber → Krise als Rätsel mit Zeitdruck → Erlösung oder Katastrophe.

---

## 3. Simulationskern (Physik) – *wie v2*

2D-Welt, Patched Conics, Kepler-Propagation, Tsiolkovsky, Pitch-Programm statt Live-Steuerung, Hohmann-Manöverplaner, vereinfachte Aerodynamik. Referenzwerte: μ Erde 398 600 km³/s², LEO ≈ 7,78 km/s, Δv nach LEO ≈ 9,3–9,5 km/s.

**Zwei Propagationsmodi** (Voraussetzung für Determinismus, §8.2):

| Modus | Wann | Rechnung | Time Warp |
|---|---|---|---|
| **Numerisch** | Brennphase, Atmosphäre | Fixed-Step, dt = 50 ms | max 4× (= 4 Ticks pro Frame, **nie** dt skalieren) |
| **Analytisch** | Küstflug | Kepler geschlossen: Position(t) exakt | beliebig, dt-unabhängig |

**Lichtlaufzeit:** `delay = dist / c` in beide Richtungen. Mars: 3–22 Minuten. Telemetrie ist alt, Befehle kommen später an – das Endgame spielt sich fundamental anders (§5.6).

---

## 4. Komponenten-System (Parts) – *wie v2, RNG-Anbindung neu*

Streuung ist **sichtbar als Band** und **beeinflussbar durch QA**; der exakte Wert bleibt verborgen, das Risiko nicht.

```typescript
interface PartInstanz extends PartDef {
  serienNr: string;                     // ← Schlüssel für den counter-basierten Draw (§8.2)!
  qaStufe: 'serie'|'acceptance'|'qualifikation'|'flightProven';
  bandSichtbar: [number, number];       // schrumpft mit QA
  zuverlaessigkeitEffektiv: number;     // = hash(seed, serienNr, 'rel') → ins Band skaliert
  verschleiss: number;
  flugHistorie: MissionRef[];
}
```

### 4.1 QA-Stufen (Zeit und Geld gegen Gewissheit)

| Stufe | Kosten | Bauzeit | Effekt |
|---|---|---|---|
| **Serie** | 1,0× | +0 Tage | Band wie Hersteller (z.B. 0,88–0,98) |
| **Acceptance-Test** | 1,3× | +3 Tage | Band halbiert, Ausreißer aussortiert |
| **Qualifikation / Hot-Fire** | 1,8× | +10 Tage | Exakter Wert bekannt, +0,01 |
| **Flight-proven** | – | – | Wert bekannt, Verschleiß +1 |

Weil der Draw an der `serienNr` hängt (§8.2), gilt: **Dasselbe Teil ist in jedem Was-wäre-wenn dasselbe Teil.** „Acceptance-Test hätte dieses Ventil aussortiert" ist damit eine beweisbare Aussage, keine Näherung.

### 4.2 Redundanz kostet Masse – *wie v2*

Backup-Ventil, zweiter Telemetriekanal, Batteriestring, Trägheits-Fallback: alles wiegt, alles frisst Δv. Leichter und riskanter oder schwerer und sicherer – das Risikobudget (§5.4) zeigt die Wirkung sofort.

---

## 5. ⚠️ Anomalie-System v3

### 5.1 Ursachen-Graph – *wie v2*

Symptome und Ursachen sind entkoppelt: Jede Ursache erzeugt 1–3 Symptome, jedes Symptom kann von 2–4 Ursachen stammen. Der Spieler sieht das Symptom, nie die Ursache.

| Symptom | Mögliche Ursachen |
|---|---|
| Tankdruck sinkt −4 %/min | Ventil träge · Leck · Drucksensor defekt · Heizung ausgefallen (Kryo) |
| Lenkung verrauscht, Wobble | Gimbal-Lager · Sensor-Rauschen · Treibstoff-Slosh · Strukturschwingung |
| Telemetrie lückenhaft | Antennenausrichtung · Handoff · Bordcomputer-Reset · Spannungsproblem |
| Busspannung sackt | Zelle defekt · Kurzschluss · Panel verschattet · Messfehler |

### 5.2 Diagnose kostet – *wie v2, plus Kontext-Priors*

Gewissheit kaufen: Sensor-Cross-Check (10 s, 1 Kanal) · Testpuls (20 s, Treibstoff, Risiko) · Engineering-Team (45 s, schneller mit Fachingenieur, §6.5) · Kanal aufschalten (verdrängt anderen Kanal). Telemetrie-Bandbreite ist begrenzt (Direktfunk 4 Kanäle, Relais 12) – Comms-Tech ist Diagnose-Tech.

**Neu:** Die Kandidaten-Wahrscheinlichkeiten sind **kontextabhängig**: Flugphase, Temperaturprofil, Vorgeschichte der Mission und Teil-Historie verschieben die Priors. „Tankdruck sinkt" bei Max-Q hat andere wahrscheinliche Ursachen als im Küstflug bei aktiver Kryo-Heizung. Zusätzlich variieren `staerke` und `verzoegerung_s` der Symptome pro Instanz (seeded) – dieselbe Ursache sieht nie exakt gleich aus.

**Ressourcen-Modell (Concurrency, verbindlich – Entscheidung aus dem finalen Review):** Jede Aktion belegt für ihre Dauer eine oder mehrere Ressourcen: einen Telemetriekanal, den jeweiligen Fachingenieur, die Treibstoffleitung, das Strombudget, einen Bordcomputer-Slot. **Alles ohne Ressourcenkonflikt läuft parallel.** Cross-Check (10 s, belegt 1 Kanal) und Team fragen (45 s, belegt Ingenieur) gleichzeitig = **45 s Makespan statt 55 s Summe** – bei einem 52-Sekunden-Eskalationsfenster der Unterschied zwischen lösbar und verloren. Die Diagnose ist damit ein Sequencing-Rätsel unter Ressourcenknappheit, kein Menü – und exakt die Flight-Director-Fantasie: echte Kontrollräume arbeiten auf parallelen Tracks.

```typescript
interface Massnahme {
  // … wie bisher, plus:
  dauer_s: number;
  belegt: RessourcenId[];   // z.B. ['kanal:beliebig', 'ingenieur:prop'] – für dauer_s exklusiv
}
```

### 5.3 Falsche Maßnahmen haben Folgen – *wie v2*

Druck erhöhen bei Leck → Leck wächst. Trägheitsnav bei gesundem Sensor → Drift. Verbraucher abschalten bei Messfehler → Heizung aus → Ventil vereist (**neue Anomalie**). Ketten stehen in den Daten (`nebenwirkungen`), das Post-Mortem deckt sie auf.

### 5.4 Risiko sichtbar + Retry mit zwei Wegen

Risikobudget im Planer *wie v2*: Loss-of-Mission-Schätzung aus Bändern, Phasenfaktoren, Redundanz, Dauer – jede Position mit Preisschild zum Drücken. Post-Mortem: *„Risiko akzeptiert: 11 %. Eingetreten: Gimbal-Lager."*

**Auslösemechanik präzisiert:** Anomalien werden beim Start aus Seed + Konfiguration bestimmt – aber über **counter-basierte Draws pro Teil** (§8.2), nicht über eine sequentielle Wurffolge.

**Nach einem Verlust zwei explizite Buttons:**

| Button | Was passiert | Wozu |
|---|---|---|
| **„Gleicher Seed, gleiche Konfiguration"** | Identischer Ablauf | Lernen: die Krise diesmal richtig diagnostizieren |
| **„Neue Konfiguration"** | Planer öffnet mit letzter Config; **nur geänderte Teile würfeln neu**, alles andere bleibt identisch | Der eigentliche Loop: QA erhöhen, Redundanz kaufen, Risiko anders einkaufen |

Der chirurgische Re-Roll ist die Antwort auf „11 % eingetreten, obwohl ich nichts falsch gemacht habe": Wer das defekte Ventil auf Acceptance testet, bekommt *beweisbar* ein anderes Ergebnis – und der Rest der Mission bleibt vergleichbar. Optionales Druckventil (im Playtest prüfen): ein Seed-Reroll pro Kampagne gegen Reputation.

### 5.5 Fairness-Regel – *wie v2*

„Jede Anomalie ist mit Information lösbar – aber Information kostet Zeit, Bandbreite oder Treibstoff. Manchmal ist die richtige Entscheidung der Abbruch, und der wird als solcher gewertet." Sauberer Abbruch zahlt Teilhonorar und Reputation.

### 5.6 Gegenskalierung & Policies – *wie v2, Editor-UX neu*

Spannungsbudget 2–4 relevante Events pro Mission, gehalten durch Missionskomplexität statt gezinkte Würfel: mehr Subsysteme (Kryo: Boil-off, Heizung), Fleet Ops (2–3 Fahrzeuge), Lichtlaufzeit, ausfallende eigene Infrastruktur.

**Policy-Editor (Avionik 4) – UX verbindlich:** Kein Freitext. **Chip-basierter visueller Editor**:

```
┌ Policy: "Deep Space Standard" (geklont aus Vorlage) ──────────┐
│  WENN [Busspannung ▾] [< ▾] [24 V]  DANN [Nutzlast aus ▾]     │
│                                     UND  [Comms halten ▾]     │
│  WENN [Tankdruck ▾]   [< ▾] [85 %]  DANN [Burn abbrechen ▾]   │
│  + Regel hinzufügen        [Vorlagenbibliothek] [Simulieren]  │
└───────────────────────────────────────────────────────────────┘
```

Vorgefertigte Policies zum Klonen und Anpassen; „Simulieren" spielt die Policy gegen das letzte Replay ab („Regel 2 hätte bei T+03:07 gegriffen"). Textansicht nur als Expertenmodus. Eine schlechte Policy bleibt eine eigene Anomalieklasse – der Spieler wird Flight Director einer Flotte, nicht Zuschauer.

### 5.7 Pause-Modell als Schwierigkeitsachse (neu – löst das Pausen-Paradoxon)

Kernregel, die das Paradoxon auflöst: **Pause stoppt die Simulation, nicht die Kosten.** In der Pause kann der Spieler lesen, Kandidaten vergleichen und **beliebig viele Aktionen in die Command-Queue legen** – aber jede kostet Sim-Sekunden, belegt ihre Ressourcen (§5.2) und wird erst nach dem Fortsetzen wirksam. Die Eskalationsuhr läuft in Sim-Zeit unaufhaltsam weiter und begrenzt den Missbrauch von selbst; ein „nur eine Aktion pro Pause"-Limit gibt es nicht (die Ein-Aktion-Variante läuft im Phase-1-Replay-Test als billiger A/B-Vergleich mit). Pause = Denken. Handeln = Zeit.

**Command-Timeline-Vorschau:** Gequeuete Befehle werden mit ihren Landezeitpunkten gegen den Eskalationsmarker angezeigt – „Handeln kostet Zeit" wird damit sichtbar *geplant* statt nur erklärt:

```
JETZT ──┬─────────┬───────────────┬────────── ▲ ESKALATION
        │ +10 s   │ +20 s         │ +45 s     │ +52 s
        Cross-    Testpuls        Team-
        Check     (wartet auf     Antwort
        fertig    freien Kanal)   fertig
```

| Modus | Regeln | Zielgruppe |
|---|---|---|
| **Standard** | Auto-Pause einmal pro *neuer* Anomalie; **weiches „RESULT READY"-Pausenangebot**, wenn ein Diagnoseergebnis eintrifft; danach manuell pausierbar (unbegrenzt) | Default, Kampagne |
| **Realzeit** | Keine Auto-Pause, keine manuelle Pause in kritischen Phasen. **„Kritische Phase" ist ein Datenflag pro Missionsphase**: Zündung → Orbit-Check sowie jede aktive Anomalie bis zur Behebung. Eskalationsfenster ×1,5 auf Tech-Stufe 1–2 | Erfahrene, „Hardcore"-Boards |
| **Daily Challenge** | Standard-Regeln, fest. Grund ist **Uniformität** (alle spielen dieselben Regeln), nicht Fairness – da alle Kosten Sim-Zeit sind, beeinflusst Pausierverhalten das Ergebnis ohnehin kaum | Leaderboard |

**Ehrliche Positionierung in der Moduswahl-UI:** *Standard = Schach mit tickender Uhr. Realzeit = Reaktionsmodus.* Beide sind legitime Spiele – wer Adrenalin erwartet, soll nicht versehentlich Schach wählen.

Damit ist Pausieren nie ein Exploit: Es verschafft Übersicht, aber keine einzige Sim-Sekunde.

### 5.8 Langzeitkurve der Diagnose (neu – gegen die Rück-Flachung)

Nach 50 Stunden kennt jeder Spieler die Metapatterns. Drei Gegenmittel, explizit getimt:

1. **Kontext-Priors und variable Symptomstärken** (§5.2): „55 %" steht nie dauerhaft für dieselbe Ursache.
2. **Ketten übernehmen das Spätspiel:** Einzelursachen werden erkennbar – `nebenwirkungen`-Ketten (Messfehler → Heizung aus → Vereisung → Flameout) bleiben kombinatorisch schwer. Der Graph wächst mit Tech-Stufe um Kettenglieder, nicht nur um Einzelfälle.
3. **Meilenstein-gekoppelte Freischaltung:** Komplexität kommt mit *Fähigkeit*, nicht mit Kalender. Die Tore hängen an Kampagnen-Meilensteinen, nicht am Missionszähler – der kämpfende Spieler bekommt nichts aufgelegt, was seine Tech nicht trägt; der schnelle Spieler wartet nicht. Die Missionszahlen sind reine Kalibrierungsdaten für die Content-Dichte:

| Erwartete Müdigkeit (Kalibrierung) | **Tor: Kampagnen-Meilenstein** | Neue Mechanik |
|---|---|---|
| ~Mission 10–12: Basis-Graph durchschaut | Erste Kryo-/Hypergol-Mission | Subsysteme (Boil-off, Heizung) + Kontext-Priors greifen voll |
| ~Mission 20–25: Einzelursachen-Meta sitzt | Erster Escape / Mondtransfer | Lichtlaufzeit + Policies (Phase 3a) |
| ~Mission 30+: Policies beherrscht | Erster angenommener Mehrfahrzeug-Vertrag | Fleet Ops + eigene Infrastruktur-Ausfälle (Phase 3b) |

Der Replay-Test aus Phase 1 (§9) liefert die ersten echten Zahlen für diese Tabelle.
---

## 6. Wirtschaft & Progression v3

### 6.1 Doktrin (einmal pro Kampagne) – *wie v2*

| Doktrin | Stärke | Preis | Natürlicher Pfad |
|---|---|---|---|
| **Masse & Menge** | Serienteile −25 %, Mehrfachnutzlast-Bonus | Präzisionsboni halbiert, kein Hot-Fire vor Stufe 3 | Konstellationen, Kommerz |
| **Präzision** | Avionik −30 %, Precision-Boni ×2 | Teile teurer, Serienfertigung gesperrt | GEO, Rendezvous, Staat |
| **Wissenschaft** | Instrumente −40 %, Daten ×1,5, geduldiger Investor | Kommerz-Reputation startet negativ, wenig Kapital | Mond, Sonden |

3 Doktrinen × 2 Startszenarien = 6 Kampagnenanfänge vor der ersten Gabelung.

### 6.2 Drei Märkte statt Leiter – *wie v2, plus Degenerations-Schutz*

Staat (sicher, langsam, verlangt QA) · Kommerz (schnell, Mengen, Vertragsstrafen) · Wissenschaft (exotische Orbits, Daten + Prestige). Reputation pro Markt; Verträge in einem Markt senken die anderen leicht. Board regeneriert wöchentlich aus Reputation + Tech. Meilenstein-Abzweigungen nach erstem LEO: GEO-Dienstleistung / Mond / Konstellation – alle erreichbar, aber Reihenfolge, Finanzierung und Gabelung unterscheiden sich.

**Neu – zwei Schutzmechanismen gegen „Kommerz-Spam druckt Geld":**
- **Mindestgarantie:** Das Board enthält nie eine Woche ohne mindestens einen *mit vorhandener Tech erfüllbaren* Vertrag pro Markt. Niemand wird ausgesperrt, aber vernachlässigte Märkte bieten schlechtere Konditionen.
- **Balancing-Kennzahl:** „Anteil genutzter Märkte pro Kampagne" wandert ins Telemetrie-Dashboard (Daily-Challenge-Daten). Fällt ein Markt kampagnenübergreifend unter ~15 % Nutzung, ist das ein Balancing-Alarm, kein Spielerfehler.

### 6.3 Forschungsdaten – *wie v2*

Verkaufen / behalten / nach Analyse verkaufen (+50 %). Downlink begrenzt durch Comms. Daten sind auch Diagnose-Währung: Firmenerfahrung schärft die Kandidaten-Priors (§5.2).

### 6.4 Tech-Baum mit exklusiven Gabelungen – *wie v2*

Stufe 1–2 linear, **Stufe 3 pro Zweig eine exklusive Wahl pro Kampagne** (Kryogen ⊕ Hypergol · Bordcomputer ⊕ Boden-Guidance · Eigenes Relais ⊕ DSN-Miete · Solar groß ⊕ RTG). Unterschiedliche Risikoprofile statt besser/schlechter; Gabelungen interagieren. New Game+ erlaubt teures Umforschen.

### 6.5 Personal – minimal spezifiziert (neu)

Kein Sims-Management, nur ein Diagnose-Modifikator mit Fixkosten:

- **2–4 Ingenieure**, je eine Spezialisierung: Prop, Avionik, Comms, Energie.
- Effekt: „Team fragen" im Fachgebiet 45 s → 25 s, Kandidaten-Priors im Fachgebiet schärfer.
- Fixkosten pro Woche; Angebotspool regeneriert monatlich; Hiring im Büro, ein Klick.
- Keine Skilltrees, keine Moral, keine Namen-Dramen. Mehr braucht das Spiel nicht – alles Weitere wäre Scope Creep.

### 6.6 Bankrott & Kampagnenende – Soft-Fail (neu)

Konto zwei Wochen unter Null → **der Investor übernimmt**: Schuldenerlass gegen Bedingungen – die nächsten 3 Verträge diktiert der Investor, ein Tech-Zweig wird für den Rest der Kampagne eingefroren, Reputationsverlust in allen Märkten. Das ist eine schmerzhafte *Entscheidungsfolge*, kein Game-Over-Screen – passend zur Entscheidungsraum-Philosophie. Ein **zweiter** Bankrott derselben Kampagne beendet sie mit einem Firmen-Post-Mortem (das sich genauso teilen lässt wie ein Missions-Post-Mortem).

Zwei Präzisierungen gegen die Todesspirale:
- **Freeze × Gabelung:** Der Freeze trifft bevorzugt einen noch ungegabelten Zweig. Ist der betroffene Zweig bereits gegabelt, wird stattdessen sein Stufe-4-Upgrade samt abhängiger Verträge gesperrt – **eine getroffene Gabelung wird niemals rückwirkend geändert.**
- **Diktat-Verträge sind garantiert machbar:** Sie werden ausschließlich aus bereits freigeschalteter Tech generiert. Ablehnen ist möglich, kostet aber Reputation – der Soft-Fail soll strafen, nicht ersticken.

### 6.7 Sandbox-Modus (neu)

Nach dem ersten Kampagnen-Meilenstein (erster stabiler Orbit) schaltet ein **freier Modus** frei: keine Fixkosten, keine Fristen, alle bereits erforschten Parts, Verträge optional als Vorlagen. Zweck: Experimentieren, Δv-Budgets testen, Story-Situationen nachbauen, Screenshots. Kostet fast nichts (dieselbe Sim ohne Ökonomie-Hooks) und bedient das „offen"-Versprechen direkt.

### 6.8 Daily & Wochen-Challenge – mit definierter Wertung (neu)

Bisher fehlte die Metrik. Festlegung:

- **Setup:** Alle spielen denselben Seed, dieselbe Doktrin, festes Budget, denselben Vertrag. Pause-Modell: Standard, fest (§5.7).
- **Wertung (in dieser Reihenfolge):**
  1. **Profit** = Honorar + Boni − Missionskosten (Teile, QA, Treibstoff)
  2. Tiebreaker 1: **Zielorbit-Präzision**
  3. Tiebreaker 2: **geringste Startmasse** – wer dieselbe Mission mit weniger Sicherheitsmasse (Redundanz, schwere QA-Teile) schafft, hat wörtlich mehr gewagt und steht höher. *(Der ursprüngliche Tiebreaker „niedrigstes akzeptiertes LOM" hätte bei Gewinnparität – dem Normalfall bei festem Seed – den Konservativen belohnt und damit der eigenen These widersprochen.)*
- **Sim-Zeit zählt nicht.** Damit gibt es keinen Speedrun-Druck, Pausieren ist wertungsneutral, und das Leaderboard belohnt genau das, was das Spiel lehren will: Risikomanagement. Wer billig und riskant fliegt und durchkommt, steht oben – wer dasselbe versucht und crasht, steht unten. Beides ist die Design-These in einer Tabelle.
- **Verifikation:** Command-Log + Zustands-Hashes (§8.2). Replays mit Mods sind wertungsfrei (§8.5).
- **Gecrashte Runs stehen im Board** – unterhalb aller Erfolge, mit negativem Profit. Sichtbares Scheitern ist Teil der Design-These; ein Leaderboard nur mit Siegern erzählt sie halb.
- **Backend ist ein eigenes Arbeitspaket** (Endpoint, Verifikations-Replay gegen Daten-Snapshots, Snapshot-Store, Betrieb) – eingeplant in Phase 3b (§9); der Daily-Launch steht deshalb am *Ende* von 3b.
- **Wochen-Challenge** (später): Realzeit-Modus als „Hardcore"-Board für Erfahrene.

---

## 7. UI/UX: Die Konsolen

Layout *wie v2*: Vollbild, dunkel, dezente CRT-Anmutung, Monospace, Tab-Leiste unten mit Sound. Konsolen:

**① LAUNCH** – Countdown, Checklisten, „LOM akzeptiert: 11 %" neben der Uhr. **GO/NOGO-Poll mit benannten Stationen** (BOOSTER · PROP · GUIDO · TELMU · FIDO · RANGE): jede Station eine Stimme, jeder Klick ein Relais-Klack. Null Systemkosten, maximale Atmosphäre.

**② FLIGHT** – Orbitkarte, Manöverplaner, Warp-Regler. Lichtlaufzeit-Anzeige (zwei Uhren: Fahrzeugzeit/Empfangszeit, „Befehl kommt an in 00:08:12"). Fleet-Reiter ab Phase 3b.

**③ COMMS** – Signalstärken, Sichtfenster, Downlink. **Kanalmatrix** (welche Telemetriekanäle live sind, Umschalten kostet Sekunden). Policy-Editor (§5.6) ab Phase 3a.

**④ ENGINEERING** – Diagnose-Panel *wie v2*: Kandidatenbalken (kontextabhängig, §5.2), Diagnose-Aktionen mit Kosten, Handeln-ohne-Gewissheit-Reihe, Eskalationsuhr.

**⑤ EVENT LOG** – Ticker *wie v2*, inkl. Diagnose-Ergebnisse und Policy-Auslösungen.

**⑥ POST-MORTEM** – Timeline, Entscheidungspunkte, Ursachenketten, Was-wäre-wenn („Acceptance hätte dieses Ventil aussortiert" – dank §8.2 beweisbar). Zwei Retry-Buttons (§5.4). Export als Replay-Datei; ab Phase 4 zusätzlich als Bild/Text fürs Teilen. **Teile-Historie ist sichtbar:** Weil Seriennummern über Missionen leben (`flugHistorie`, Verschleiß), zeigt das Post-Mortem die Vorgeschichte jedes beteiligten Teils – *„Ventil #4731 war schon in Mission 3 auffällig."* Kostenlose Firmen-Lore; die Community wird ihren Seriennummern Geschichten anhängen. Null Systemkosten, direkter Treibstoff fürs Sharing.

### 7.7 Hotkey-Schema (neu, verbindlich ab Phase 1)

Wenn eine Krise 60 Sim-Sekunden hat, entscheidet die Tastatur über das Spielgefühl:

| Taste | Funktion |
|---|---|
| `1`–`5` | Konsole wechseln (mit Konsolen-Sound) |
| `Space` | Pause / Fortsetzen |
| `+` / `-` | Time Warp rauf/runter |
| `Q` `W` `E` | Maßnahmen im Diagnose-Panel – **stabile Sortierung**: nach Kandidaten-Prior beim Öffnen des Panels sortiert, dann eingefroren (kein Umsortieren unter der Hand); Key-Hints inline an jedem Button |
| `D` | Diagnose-Menü fokussieren |
| `L` | Event-Log fokussieren |
| `Enter` | GO im Poll / Maßnahme bestätigen |

Rebinding ab Phase 2. Jede neue UI-Funktion muss ab sofort mit Hotkey spezifiziert werden – nachrüsten ist teuer.

### 7.8 Barrierefreiheit (neu)

Warnstufen nie nur über Farbe: immer **Symbol + Text-Tag + Farbe** (`▲ WARNING`, `■ CRITICAL`). Alternative Farbpalette für Farbschwäche (~8 % der Zielgruppe), Mindestschriftgrößen für die Monospace-Displays, Alarm-Sounds unterscheidbar nach Schwere (nicht nur Lautstärke).

Sound-Design *wie v2* (Web Audio, synthetisch; Lichtlaufzeit-Echo auf gesendete Befehle).

---

## 8. Technische Architektur

### 8.1 Stack – *wie v2*

Vite · TypeScript strict · Svelte · Canvas 2D + SVG · Web Audio · Sim-eigener Store · JSON/IndexedDB.

### 8.2 Determinismus-Spezifikation v3 (verbindlich ab Phase 0)

1. **Die Sim kennt nur Ticks (Integer).** Kein `Date`, kein `performance.now()`, kein Wanduhr-Zugriff in `src/sim/`.
2. **Time Warp = mehr Ticks pro Frame** (numerisch) bzw. analytische Auswertung bei `t` (Küstflug). Nie dt skalieren.
3. **Alle Eingaben sind Tick-gestempelte Commands.** UI schreibt in eine Queue, Sim wendet an der Tick-Grenze an.
   ```typescript
   interface Command { tick: number; type: string; payload: unknown; }
   interface Run {
     gameVersion: string;
     dataVersion: string;      // Hash über data/*.json (+ Mod-Hashes, §8.5)
     seed: number;
     konfiguration: MissionConfig;
     commands: Command[];
     stateHashes: { tick: number; sha256: string }[];  // alle 600 Ticks (30 s)
   }
   ```
4. **RNG in zwei Mechanismen (Entscheidung aus dem Review, fixiert):**
   - **Counter-/hash-basierte Draws** für alles Konfigurationsgebundene:
     `roll = hash64(seed, teil.serienNr, kontext)` → Teil #4731 hat dieselbe Zuverlässigkeit und dieselben Fehlerzeitpunkte, egal was sonst konfiguriert wird. Konsequenzen: Was-wäre-wenn im Post-Mortem ist **exakt**, der Retry mit neuer Konfiguration ist **chirurgisch** (nur geänderte Teile würfeln neu), Debugging wird trivial („gib mir den Roll von Teil X").
   - **Sequentielle `mulberry32`-Streams** nur für echte Ereignis*folgen* ohne Konfigurationsbezug: Sonnenaktivität, Marktbewegungen, Vertragsgenerierung. Getrennte Streams pro System, damit eine zusätzliche Abfrage nicht alle Folgewürfe verschiebt.
   - **Das hash64-Primitiv ist Kernmechanik, kein Implementierungsdetail** (Was-wäre-wenn und chirurgischer Retry hängen daran): festgelegt als **2×32-Bit-Lane-Mixing** (xmur3-/cyrb53-Familie, kein BigInt im Hot Path), mit **gepinnten Testvektoren im Repo**. Jede Änderung am Hash ist ein Breaking Change und erhöht die dataVersion.
5. **Kein `Math.random`; eigene Transzendenten** (`sim/math.ts`, Chebyshev/Taylor, ~60 Zeilen) – `Math.sin/exp` sind nicht engineübergreifend bitidentisch.
6. **Auto-Pause ist ein Sim-Zustand** an einem Tick, kein UI-Timer.
7. **Replay-Kompatibilität:** Ein Replay pinnt `gameVersion` + `dataVersion`. Daily-Challenge-Replays werden serverseitig mit Daten-Snapshot archiviert; alte Replays laufen gegen ihren Snapshot, nicht gegen aktuelle Daten. Breaking Changes an `data/*.json` erhöhen die dataVersion – Richtlinie ab Phase 0, nicht nachträglich.
8. **Desync-Detektion:** Zustands-Hash alle 600 Ticks im Run (s.o.) – eine Abweichung wird auf ein 30-Sekunden-Intervall lokalisiert statt auf den ganzen Lauf. Der Hash läuft **nie über `JSON.stringify`** – Float-Formatting unterscheidet sich zwischen Engines (dieselbe Bugklasse wie `Math.sin`: besteht lokal, bricht beim ersten Cross-Browser-Daily). Stattdessen: **kanonische Binärcodierung** mit fester Schema-Reihenfolge, `DataView.setFloat64` little-endian, Bytes hashen; `NaN`/`Infinity` per Debug-Assert verboten.
9. **Mid-Mission-Save = Replay-Prefix:** `{Run bis Tick n}` serialisieren; Fortsetzen = deterministisch bis Tick n abspulen (bei 20 Hz Sim unter einer Sekunde). Auto-Save alle 30 s Realzeit und bei `visibilitychange` (Web-Tabs schließt man eben mal). Damit ist der Save kein eigenes System, sondern ein Nebenprodukt der Replay-Architektur. *Notierte Zukunftsaufgabe (bewusst nicht jetzt):* Snapshot-Kompaktion für sehr lange Kampagnen (Zustandsfoto + Log-Suffix statt linearem Gesamtlog).
10. **CI-Test:** Seed 42 + festes Command-Log → SHA-256 des Endzustands. Bricht der Hash, bricht der Build. Jede Sim-PR muss die Replay-Fixtures bestehen.

### 8.3 Modulstruktur

```
src/
├── sim/                  // KEINE UI-Imports, KEINE Wanduhr
│   ├── engine.ts         // Ticks, Command-Queue, Warp-Modi, Pause
│   ├── math.ts           // deterministische Trig/Exp
│   ├── rng.ts            // hash64-Draws + mulberry32-Streams
│   ├── physics/          // kepler.ts, thrust.ts, ascentProgram.ts, lightDelay.ts
│   ├── diagnosis/        // ursachenGraph.ts, priors.ts, massnahmen.ts
│   ├── policy/           // Chip-Regel-Interpreter
│   └── systems/          // anomaly.ts, comms.ts, power.ts, fleet.ts
├── data/                 // parts.json, techtree.json, ursachen.json, vertraege.json, doktrinen.json
├── economy/              // maerkte.ts, reputation.ts, personal.ts, risikobudget.ts
├── replay/               // Run-Serialisierung, Playback, Hashing, Save-Prefix
├── tools/                // graphLint.ts (§8.4), balanceDashboard/
├── ui/
│   ├── consoles/         // launch/, flight/, comms/, engineering/, postmortem/
│   ├── widgets/          // Gauge, ToggleSwitch, SevenSeg, DiagnosePanel, KanalMatrix, PolicyChips
│   ├── hotkeys.ts        // zentrales Schema (§7.7)
│   └── audio/
└── save/
```

### 8.4 Ursachen-Graph-Linting in CI (neu)

Der Graph ist Daten – also wird er maschinell geprüft, bei jeder Änderung an `data/ursachen.json`:

1. Jede Ursache hat ≥ 1 korrekte Maßnahme **und** ≥ 1 plausibel-falsche Maßnahme (sonst dominiert Blindhandeln).
2. Kein Symptom hat genau eine Ursache (sonst Lookup-Tabelle).
3. Jedes Symptom ist von mindestens einer Ursache erreichbar (keine Daten-Leichen).
4. **Zeitfenster-Check (Makespan):** Für jede Ursache existiert ein Diagnose+Maßnahmen-*Plan*, dessen **kritischer Pfad unter Ressourcenbeschränkungen** (§5.2) ins Eskalationsfenster passt. Die Summe der Einzelkosten wäre bei Parallelität die falsche Mathematik – Cross-Check (10 s, Kanal) ∥ Team fragen (45 s, Ingenieur) hat Makespan 45 s, nicht 55 s.
5. Jede `nebenwirkungen`-Kette terminiert (kein Zyklus ohne Ausweg).

Erst damit ist „neue Anomalie = nur ein JSON-Eintrag" wahr *und* sicher. Der Papier-Playtest (§11) bleibt zusätzlich Pflicht – der Linter prüft Lösbarkeit, nicht Spannung.

### 8.5 Modding als explizites Feature (neu)

Die Datenarchitektur *ist* bereits Modding-Fähigkeit – sie wird nur benannt und abgesichert:

- **`/mods`-Ordner** mit Ladereihenfolge; moddbar: Parts, Ursachen-Graph, Verträge, Doktrinen, Szenarien, Sounds.
- **JSON-Schema-Validierung** beim Laden (dieselben Schemas wie der Linter §8.4) – ein kaputter Mod wird abgewiesen, nicht geladen.
- Replays tragen die Mod-Hashes in `dataVersion`; **gemoddete Runs sind von Daily-Wertungen ausgeschlossen**, aber teilbar.
- Ab Phase 4: Steam-Workshop-Anbindung über den Tauri-Port.

Für ein Spiel dieser Art ist Modding der stärkste Wiederspielwert-Multiplikator pro investierter Stunde – und hier kostet er fast nichts.

---

## 9. Entwicklungs-Roadmap v3

### Phase 0 – „Der Countdown" *(1–2 Wochen)*
- Fest verdrahtete 2-Stufen-Rakete, LAUNCH Console, Countdown-State-Machine, Pitch-Programm, Kepler, Orbitkarte
- **Von Tag 1:** Tick-Engine, Command-Queue, **hash64-Draws + Stream-RNG** (Entscheidung ist gefallen, §8.2), Run-Format inkl. Versionen und State-Hashes, Replay + Hash-CI
- **Done wenn:** Man will sofort wieder „Start drücken" – und ein Replay läuft bitgleich, auch nach Save/Resume mitten im Flug.

### Phase 1 – „Die Diagnose" *(4 Wochen + Puffer)*
- Ursachen-Graph v1: 4 Ursachen, 6 Symptome, 8 Maßnahmen mit Nebenwirkungen (JSON) — **Graph-Linter zuerst** (§8.4)
- Engineering Console mit Diagnose-Panel, Kanalmatrix (4 Kanäle), Kontext-Priors v1
- **Pause-Modell Standard** inkl. Command-Timeline und RESULT-READY (§5.7), **Ressourcen-Parallelität** (§5.2) und **Hotkey-Schema** (§7.7) von Anfang an; der A/B-Vergleich „unbegrenztes Queuing vs. eine Aktion pro Pause" läuft im Replay-Test mit
- Risikobudget (statisch), Post-Mortem mit Ursachenkette, **zwei Retry-Buttons**
- **Replay-Test:** 3 Tester spielen dieselbe Mission 5×; gemessen wird, ab wann sie ohne Diagnose richtig raten. **Done wenn:** Durchlauf 5 noch überrascht – sonst Graph verdichten, bevor Phase 2 beginnt. Die Ergebnisse kalibrieren die Müdigkeits-Tabelle (§5.8).

### Phase 2 – „Das Spiel entsteht" *(5–7 Wochen)*
- 3 Doktrinen, 3 Märkte mit Reputation + **Mindestgarantie**, wöchentliches Board
- Konfigurator mit QA-Stufen und Redundanz, Risikobudget live
- Tech-Baum Stufe 1–3 (Antrieb + Avionik) inkl. erster Gabelung
- COMMS Console, Forschungsdaten, **Personal minimal** (§6.5), **Bankrott-Soft-Fail** (§6.6)
- **Mid-Mission-Save prominent** (Auto-Save läuft ohnehin, §8.2)
- 2 Startszenarien; **Sandbox-Unlock** nach erstem Orbit
- **Tutorial-Missionen** (gescriptete 1:1-Krisen auf der Seed-/Replay-Infrastruktur – Autorenaufwand wird chronisch unterschätzt, deshalb hier explizit eingeplant)
- **i18n-Entscheidung:** Strings extern (die Datenarchitektur legt es ohnehin nahe), Seven-Seg-Widgets mit Text-Fallback für Umlaute – vorbereiten kostet fast nichts, nachrüsten ist teuer
- **Done wenn:** Zwei Kampagnen mit verschiedenen Doktrinen fühlen sich nach 3 Stunden unterschiedlich an – nicht nur anders bemalt.

### Phase 3a – „Autonomie über Distanz" *(3–4 Wochen)*
- Lichtlaufzeit + Policy-Editor (Chip-UI, Vorlagen, Simulieren-Knopf) – **ein** Fahrzeug
- Realzeit-Modus (§5.7)
- **Done wenn:** Eine Mars-Sonde mit 8 Minuten Delay erzeugt Gänsehaut statt Wartezeit.

### Phase 3b – „Die Flotte" *(3–4 Wochen)*
- Fleet Ops (bis 3 Fahrzeuge, Missionsvorlagen erzwingen versetzte kritische Phasen)
- Eigenes Relais als ausfallende Infrastruktur, Versicherung, Investoren
- Sound-Design komplett, GO/NOGO-Poll mit Stationen
- **Leaderboard-Backend** als eigenes Arbeitspaket (~1 Woche Engineering + laufende Betriebskosten): Endpoint, Verifikations-Replay gegen Daten-Snapshots, Mod-Ausschluss
- **Daily Challenge live** mit Wertung nach §6.8 – **am Ende von 3b**, nach dem Backend
- **Done wenn:** Eine Endgame-Mission erzeugt denselben Puls wie der erste Start – gemessen am Spannungsbudget (2–4 Events) und am Tester.

### Phase 4 – Polish & Öffnung *(fortlaufend)*
- **Modding offiziell** (Ordner, Schema, Doku; Workshop mit Steam-Port)
- Ghost-Replays, Post-Mortem-Export als **Bild/Text** (Story-Sharing), Statistiken, Erfolge
- Wochen-Challenge (Realzeit-Board), drittes Szenario, New Game+, Interplanetar
- Steam via Tauri, Cloud-Saves

---

## 10. Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Physics-Rabbit-Hole | 2D + Patched Conics, eisern. „Plausibel schlägt perfekt." |
| Scope Creep bei Parts | ≤15 Parts pro Phase |
| Diagnose-Graph zu hart für Einsteiger | Tutorial-Missionen mit 1:1-Fällen; Priors starten gleichverteilt; Graph verdichtet sich mit Tech |
| **Diagnose flacht langfristig ab** | Kontext-Priors, Ketten-Spätspiel, getimte Freischaltung (§5.8); Müdigkeits-Tabelle wird mit Replay-Test-Daten kalibriert |
| **Pause wird zum Exploit** | Pause stoppt Sim, nicht Kosten (§5.7); Daily-Wertung zeitunabhängig |
| Eine Doktrin dominiert | Preise in JSON; Kennzahl „Marktnutzung pro Kampagne" im Dashboard; Balancing-Pass pro Phase |
| Determinismus bricht unbemerkt | Hash-CI ab Phase 0; State-Hashes alle 600 Ticks lokalisieren Desyncs; Versions-Pinning |
| **Policy-Editor schreckt ab** | Chip-UI + Vorlagenbibliothek + Simulieren-Knopf; Text nur als Expertenmodus |
| Fleet Ops überfordert die UI | Max 3 Fahrzeuge; Auto-Pause benennt das Fahrzeug; versetzte kritische Phasen |
| Spannungsbudget kippt ins Unfaire | Events nur aus sichtbaren Risikofaktoren; kein Würfel-manipulierender „Director" |
| **Mods brechen Replays/Wertung** | Mod-Hashes in dataVersion; gemoddete Runs wertungsfrei |
| **Phasenpläne zu optimistisch** | Phase 3 ist gesplittet; Phase 1 hat expliziten Puffer; jede Phase hat ein messbares Abbruchkriterium |
| Leere Küstflugphasen | Time Warp + Mini-Events; ab 3b: anderes Fahrzeug bedienen |
| Arbeitstitel kollidiert markenrechtlich | Kurze Recherche vor Phase 2, dann festlegen |
| **Endlose Dokument-Iteration statt Playtest** | Design-Freeze ab v4: Änderungen nur noch aus Playtest-Evidenz – die nächste Version dieses Dokuments schreibt der Phase-1-Test |

---

## 11. Nächster konkreter Schritt

**Zuerst Papier, dann Code – in dieser Reihenfolge:**

1. **`ursachen.json` schreiben** (4 Ursachen, 6 Symptome, 8 Maßnahmen **mit Ressourcenbelegung**, 2 Nebenwirkungs-Ketten) und am Papier durchspielen – mit der Concurrency-Frage im Gepäck: *Findet ein Spieler mit zwei **parallel geplanten** Diagnoseschritten in 60 Sim-Sekunden die Ursache? Gibt es für jede Ursache eine plausibel-falsche Maßnahme? Und macht die Ressourcenknappheit (ein Ingenieur, vier Kanäle) die Reihenfolge interessant?* Das ist der einzige Test, der über das Herzstück entscheidet – vor jeder Zeile UI.
2. **`graphLint.ts`** gegen genau diese Datei bauen (5 Regeln, §8.4 – Regel 4 als Makespan-Check) – Werkzeug und Inhalt validieren sich gegenseitig.
3. **Phase-0-Prototyp** mit der fixierten RNG-Entscheidung:
   - `sim/engine.ts`: Tick-Loop, Command-Queue, zwei Warp-Modi (~60 Zeilen)
   - `sim/rng.ts`: hash64-Draw + mulberry32-Streams; `sim/math.ts`: eigene sin/cos/exp (~100 Zeilen)
   - Kepler-Propagator, Countdown-State-Machine `HOLD → ARMED → IGNITION → LIFTOFF → MAX_Q → MECO → SEP → ORBIT_CHECK`
   - Höhen-Gauge, Seven-Segment, Event-Log, Synth-Klicks, Hotkeys `1`–`5` + `Space`
   - `replay/`: Run serialisieren, abspielen, hashen — **Test: Save bei T+90 s, Resume, Endzustands-Hash identisch mit Durchlauf ohne Save.**
