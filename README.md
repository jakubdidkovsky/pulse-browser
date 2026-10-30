# Pulse ✦

Prohlížeč postavený na Chromiu (Electron) s AI zabudovanou přímo do prohlížeče. UI je laděné do stylu Apple.

## Spuštění

```bash
cd ~/aibrowser
npm install          # stačí jednou
npm start
```

Volitelné:

```bash
npm run install-desktop   # přidá Pulse do menu aplikací (Linux)
npm run fix-sandbox       # zapne plný Chromium sandbox (Ubuntu 24.04+, chce sudo)
```

## Co umí

| | |
|---|---|
| **AI panel** (`Ctrl+E`) | Postranní panel, který jde schovat. AI vidí text stránky, tvůj výběr, otevřené taby a nedávnou aktivitu. Volitelně i screenshot stránky. Další taby přidáš do kontextu přes `+`. |
| **Přihlášení k AI** | **Předplatné:** Claude (přes Claude Code), ChatGPT (Codex CLI), Cursor (cursor-agent), Gemini CLI. **API klíče:** Anthropic, OpenAI, Gemini, OpenRouter, Ollama (lokálně). **Web:** Claude.ai, ChatGPT, Gemini, Perplexity, Cursor přímo v panelu; tlačítko „Send page“ vloží stránku do chatu. |
| **AI agent** (přepínač *Agent* v panelu) | Ovládá stránku vlastním kurzorem: kliká, píše, scrolluje, otevírá stránky a taby. Před riskantními kroky (zaplatit, odeslat, smazat) se zeptá. Funguje přes Claude Code (tvoje předplatné) i přes Claude API (nejrychlejší). Konverzace navazují (Claude Code `--resume`). |
| **Změna úkolu za běhu** | Když agent pracuje, piš mu dál. Zprávu dostane u dalšího kroku a úkol podle ní změní nebo doplní. Když mezitím skončí, vezme ji jako další úkol. V chatu se zprávy během odpovědi řadí do fronty. |
| **Lišta oblíbených** (`Ctrl+Shift+B`) | Připnuté stránky jsou nahoře pod adresním řádkem. Ctrl/prostřední klik otevře čistou kopii, pravý klik umožní přejmenovat nebo odepnout. Pořadí změníš přetažením. To, co se nevejde, je pod šipkou. Umístění (nahoře / v boční liště) jde přepnout v Nastavení → General. |
| **Chat vs. agent** | Výchozí je *Agent*: na otázky odpoví hned ze stránky a když je potřeba něco udělat, udělá to sám. V režimu *Ask only* se akce (najdi, otevři, objednej…) samy přepnou na agenta. |
| **Spotřeba Pulse** (Nastavení → Usage, nebo klik na kroužek s % v AI panelu) | Jen to, co spotřebuje Pulse, bez Claude Code v terminálu a claude.ai: počet úkolů a chatů, tokeny, cena podle API ceníku a čas za dnešek / 7 / 30 dní, graf po dnech a rozpad podle webů a modelů. Pro srovnání je tam i limit celého Claude účtu. Data zůstávají lokálně 90 dní. |
| **Ukazatel limitu** | V hlavičce AI panelu je kroužek s tím, kolik ti zbývá z Claude plánu (5hodinový i týdenní limit, čas resetu v tooltipu). U API klíče je tam cena konverzace. |
| **Anonymní okno** (`Ctrl+Shift+N`) | Oddělené okno s vlastním vzhledem: žádná historie, session, cookies na disku, AI chaty ani soubory. Zavřením okna se vše smaže. |
| **Pravidla pro taby** | „Max N tabů z jednoho webu, ty navíc zavři po X min nečinnosti“, pro všechny weby nebo konkrétní (např. notion.com). Nastavení → General, nebo to řekni agentovi. |
| **Úvodní stránka** | Nejnavštěvovanější, vlastní zkratky, nebo nic (tlačítko *Customize* vpravo dole, nebo Nastavení → General). |
| **Konektory z Claude** | Agent (přes Claude Code) používá i to, co máš připojené v Claude: Gmail, Google Calendar, Notion, Slack… Čtení proběhne hned, odeslání, vytvoření, úprava nebo smazání vyžaduje tvoje schválení (Povolit / Vždy povolit / Zakázat). Jednotlivé konektory zapneš nebo vypneš v Nastavení → AI → Connectors. Pluginy Claude Code jsou ve výchozím stavu vypnuté. |
| **Nikdy nezavírat** | Pravý klik na tab → *Never Close Automatically* (ikona zámku). Takový tab nezavře žádné pravidlo, archivace, uspávání ani AI úklid. Ručně ho zavřít jde dál. |
| **Práce s počítačem** | Agent (přes Claude Code) spouští příkazy a čte i upravuje soubory ve zvolené složce, jako `claude` v terminálu. Složku vybereš tlačítkem se složkou pod chatem. Příkazy a změny souborů ukáže v náhledu (terminál, rozdíl v souboru) a čeká na tvoje *Run / Allow for this task / Don't allow*. Jednoduché čtecí příkazy (`ls`…) Claude Code povolí sám. |
| **Plovoucí chat** | Tlačítko v hlavičce chatu ho odepne do plovoucího okna. Přesouváš ho za tři tečky nahoře nebo za hlavičku, velikost měníš za roh. Stejné tlačítko nebo dvojklik na hlavičku ho vrátí zpět doprava. |
| **Rozdělené okno** | Tlačítko s rámečkem vedle adresního řádku: 2 stránky vedle sebe, 2 nad sebou nebo 4 v mřížce. Aktivní stránka má modrý rámeček a řídí se podle ní adresní řádek i AI. Tab otevřený z lišty se ukáže v aktivní části. Velikost částí měníš tažením mezery mezi nimi, dvojklik ji vrátí na půl. Pravý klik na tab → *Open in Split View* / *Remove from Split View*. **Zavření:** v hlavičce každé části je ▢ (nechat jen tuhle stránku) a × (odebrat z rozdělení); nebo tlačítko rozvržení → *Close Split View*. Zavřeš-li jednu ze dvou stránek, rozdělení skončí samo. Umí to i agent („dej X a Y vedle sebe“). |
| **Rozšíření z Chrome** | Na [Chrome Web Store](https://chromewebstore.google.com) klikni na *Add to Pulse*. Před instalací se ukáže, k čemu bude mít rozšíření přístup. Ikonky rozšíření jsou vedle adresního řádku (klik otevře rozšíření, pravý klik jeho menu). Správa: `⋯` → *Extensions…* nebo Nastavení → Extensions. Menu MV3 rozšíření (např. Dark Reader) potřebuje zapnutý Chromium sandbox: jednou spusť `npm run fix-sandbox`. V anonymním okně rozšíření neběží. |
| **Tabule** (tlačítko vedle adresního řádku) | Lehké kreslení přes stránku: pero, čáry, šipky (připnou se k tvarům), obdélníky, elipsy, text, lepicí papírky, guma, barvy, Zpět/Znovu, posun (tažení prázdného místa / mezerník) a zoom (Ctrl + kolečko). Klávesy V P L A R O T N E. **Dočasná** tabule se po zavření (×) úplně smaže, **uložená** zůstane v seznamu tabulí (ikona vlevo nahoře). Agent na ni umí kreslit diagramy a plány („nakresli mi na tabuli…“) a vidí i to, co nakreslíš ty. **Obrázky:** Ctrl+V, přetažení souboru nebo tlačítko s fotoaparátem; agent vloží obrázek z adresy nebo snímek stránky. **Spolu naživo:** „pojďme spolu kreslit / reaguj na to, co kreslím“ — agent čeká na tvoje tahy, sám se rozhodne co přidat (seskupit, propojit, doplnit nápad) a pokračuje, dokud nenapíšeš stop. Když kreslíte oba zároveň, v každém kroku se dozví, co jsi změnil. |
| **Ask AI About This** | Pravý klik kamkoliv na stránce. AI dostane to, na co ukazuješ: text, odkaz nebo obrázek, pozici na stránce, selektor, nadpis sekce, okolní text a u tabulek i sloupec a řádek. U modelů s obrázky dostane i výřez obrazovky. Pak napiš „co to je“ nebo „klikni na to“. Agent má prvek ve svém pohledu na stránku označený. |
| **Google Lens** | Pravý klik na obrázek → *Search Image with Google Lens*. Agent ho používá sám, když jde o to, jak něco vypadá (najdi podobné, kde to koupit, co to je). |
| **Cookie lišty** | Nastavení → Privacy: *Smart* (odmítne volitelné cookies a přijme jen tam, kde jiná možnost není), *Reject*, *Accept* nebo *Off*. Používá pravidla DuckDuckGo Autoconsent a pro neznámé lišty vlastní záchranu. Funguje i na stránkách agenta. |
| **Povolení webů** | Nastavení → Privacy: pro polohu, kameru a mikrofon, notifikace, schránku, sdílení obrazovky a zařízení nastavíš *Ask / Allow / Block*. Rozhodnutí pro jednotlivé weby uvidíš a smažeš tamtéž. |
| **Přihlašovací okna** | Pop-upy typu „Přihlásit přes Google“ jsou samostatná okna, aby přihlášení fungovalo. Agent se do nich sám přepne, dokončí přihlášení a vrátí se na stránku. |
| **Paměť webů** | `~/Documents/Pulse/sites/<web>/CONTEXT.md` obsahuje, co se agent o webu naučil (a co tam dopíšeš ty). `sessions/*.md` jsou kompletní přepisy každé session včetně volání nástrojů. |
| **Úklid tabů** (tlačítko *Tidy*) | Uspořádání tabů do skupin s AI, zavření nepotřebných tabů s AI, řazení podle posledního použití / webu / názvu, zavření duplikátů a tabů nepoužitých 1 h až týden. Vše jde vrátit přes Undo. |
| **Automatický úklid** | Taby nepoužité 45 min se uspí (uvolní paměť) a taby neotevřené den se archivují. Počítá se jen čas, kdy Pulse běží. Obojí jde nastavit v Nastavení → General. Archiv: Historie → Archived Tabs. |
| **Skupiny** | Barevné skupiny v liště s pravidly, např. `notion.so` → vždy do skupiny „Work“. Taby se do skupin dají i přetáhnout. |
| **Připnutí** (`Ctrl+D`) | Připnuté weby jsou nahoře v liště jako dlaždice. Zavření je jen uspí. Tab jde i vytáhnout do **plovoucího okna**, které zůstává nad ostatními okny. Celé okno jde držet navrchu přes `⋯` → Keep Window on Top. |
| **Historie** (`Ctrl+Y`) | Vyhledávání, seskupení podle dnů, mazání položek i rozsahů. |
| **Command bar** (`Ctrl+T` / `Ctrl+K`) | Otevře web, vyhledá, přepne tab, prohledá historii, spustí akci, nebo se rovnou zeptá AI. |
| **Další** | Obnovení session, find in page, zoom, stahování, oprávnění webů, světlý/tmavý režim a barva zvýraznění. |

## První spuštění

Při prvním startu provede Pulse krátkým nastavením: jakou AI použít, co smí agent (počítač, konektory, ptaní před odesláním), cookie lišty a povolení webů, úklid tabů a vzhled. Znovu ho spustíš v Nastavení → About → *Run Setup Again* nebo v command baru („Welcome & Setup“).

## Klávesové zkratky

`Ctrl+T` nový tab · `Ctrl+L` adresa · `Ctrl+W` zavřít · `Ctrl+Shift+T` obnovit zavřený · `Ctrl+Tab` další tab · `Ctrl+1…9` tab N · `Ctrl+E` AI · `Ctrl+\` lišta · `Ctrl+D` připnout · `Ctrl+Shift+B` lišta oblíbených · `Ctrl+Shift+N` anonymní okno · `Ctrl+F` hledat · `Ctrl+Y` historie · `Ctrl+,` nastavení

## Poznámky

- API klíče se šifrují systémovou klíčenkou (`safeStorage`) a renderer je nikdy nevidí.
- CLI providery běží v prázdné složce a bez nástrojů (Claude Code s `--tools ""`, Codex v režimu `read-only`).
- Data: `~/.config/Pulse/` (Linux).
