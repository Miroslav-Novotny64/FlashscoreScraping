# Flashscore API Scraper (Microservice)

Tento projekt je modifikovaný fork původního scraperu [gustavofariaa/FlashscoreScraping]. Původní logika byla přepracována z lokálního skriptu generujícího soubory na samostatnou mikroslužbu poskytující data prostřednictvím JSON rozhraní.

## Klíčové změny a vylepšení

* **Transformace na API:** Server využívá nativní Node.js `http` modul pro poskytování dat přes endpoint `/api/scrape`.
* **Optimalizace výkonu:** Původní implementace vyžadovala lineární počet požadavků $O(N)$ vzhledem k počtu zápasů. Tato verze byla optimalizována na konstantní počet požadavků $O(2)$ (paralelní sběr dat z indexů "results" a "fixtures"), což dramaticky snižuje čas exekuce a náročnost na systémové prostředky.

## Technická specifikace API

### Endpoint: `GET /api/scrape`

Služba očekává tři povinné query parametry pro sestavení validní Flashscore URL.

**Parametry:**
* `sport`: Typ sportu (např. `hockey`)
* `country`: Země (např. `world`)
* `league`: Název ligy (např. `world-championship`)

**Příklad pro mezinárodní turnaje (např. MS v hokeji):**
```http
GET /api/scrape?sport=hockey&country=world&league=world-championship
