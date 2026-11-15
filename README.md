# Porównywarka cen AGD / RTV

Aplikacja działa w przeglądarce na telefonie i na komputerze, a **Twój komputer nie musi być włączony**.

Wpisujesz model, EAN albo robisz zdjęcie tabliczki, a aplikacja:

- **szuka po opisie**: „płyta indukcyjna”, „lodówka do 200cm”, „płyta indukcyjna pięciopolowa”, „pralka 8kg do 2000 zł”. Pokazuje sprzęt na promocji, a kolejność ustalają **opinie z poprawką na ich liczbę**, więc model z jedną opinią 5/5 nie wyprzedzi takiego z 400 opiniami po 4,8,
- **wykrywa pozorne promocje**: porównuje „cenę przed obniżką” i „cenę bez kodu” z najniższą ceną z 30 dni oraz z własną historią cen,
- liczy **raty gratis** (ile naprawdę zapłacisz) i wypisuje osobno **zwroty i bony**, których nie odejmuje od ceny,
- przyciskiem **„Podobne, tańsze”** szuka modeli o tych samych albo lepszych parametrach za mniej,
- porównuje ceny w sklepach RTV EURO AGD, Media Expert, Neonet, Media Markt, OleOle!, x-kom, Komputronik i Morele, a przez **Ceneo** także w Allegro, empiku, electro.pl i innych,
- w koszyku liczy, gdzie najtaniej kupić kilka sprzętów, z promocjami typu „X zł za każde 500 zł”, „5. produkt za 1 zł” czy „drugi −50%”,
- rysuje **wykres historii ceny**,
- sprawdza **dostępność w salonie** w Twoim mieście,
- przyciskiem **„Promocje teraz”** sprawdza aktualne promocje w sklepach: raty gratis, „67 zł za każde 500 zł”, N-ty produkt, kody, zwroty. Dla każdej podaje, do kiedy trwa, jaki ma kod, czy to rabat od razu czy bon, i z czym się nie łączy,
- obserwuje wybrane produkty i **wysyła powiadomienie na telefon**, kiedy cena spadnie.

## Wygląd

Aplikacja nawiązuje do unijnej **etykiety energetycznej**. Każdy sklep dostaje strzałkę „klasy cenowej”: **A** oznacza najtaniej, a każda kolejna litera to drożej (B do 2%, C do 4%, D do 7%, E do 10%, F do 15%, G powyżej).
Wiersze płynnie przesuwają się na swoje miejsce, kiedy przychodzą kolejne ceny. Zakładki, panele i komunikaty mają animowane przejścia.
Przy włączonym w telefonie „ograniczeniu ruchu” animacje są wyłączone.

## Jak to działa bez komputera

```
Telefon / komputer ──► strona aplikacji (GitHub Pages, darmowa)
        │                     │
        │  „szukaj”           ▼
        └──────────► GitHub Actions (darmowa maszyna w chmurze GitHuba)
                       otwiera sklepy, odczytuje ceny i zapisuje wynik w Twoim repozytorium
```

Jedno wyszukiwanie trwa zwykle **1–2 minuty**, bo GitHub musi uruchomić maszynę. Wyniki pojawiają się na bieżąco.
Rozpoznawanie zdjęć działa w samym telefonie.

---

## Instalacja (jednorazowo, ok. 15 minut, najwygodniej na komputerze)

> **Chcesz, żeby wyszukiwania i ceny nie były publiczne?** Zrób wariant z dwoma repozytoriami opisany w sekcji
> „Wariant prywatny” poniżej. Jest tak samo darmowy.

### 1. Konto i repozytorium
1. Załóż konto: https://github.com/signup (darmowe).
2. Utwórz repozytorium: https://github.com/new
   - **Repository name:** `ceny-agd` (albo dowolna inna nazwa)
   - **Public**: wtedy GitHub Actions i Pages są darmowe bez limitów.
     Kod i wyszukiwane modele z cenami będą publiczne. Token i hasła nie są tam zapisywane.
   - Kliknij **Create repository**.

### 2. Wgraj pliki
1. Rozpakuj `porownywarka-agd.zip` na komputerze.
2. Na stronie nowego repozytorium kliknij **„uploading an existing file”**.
3. Otwórz rozpakowany folder `porownywarka-agd`, zaznacz **całą jego zawartość** (Ctrl+A), razem z folderem `.github`, i przeciągnij na stronę.
   - Na Macu folder `.github` jest ukryty, pokaż go skrótem Cmd+Shift+. (kropka).
4. Na dole kliknij **Commit changes**.

### 3. Włącz stronę
1. W repozytorium otwórz **Settings → Pages**.
2. W polu **Source** wybierz **GitHub Actions**.
3. Przejdź do zakładki **Actions** → po lewej **Strona** → **Run workflow** → **Run workflow**.
4. Po ok. minucie aplikacja działa pod adresem: **`https://TWÓJ-LOGIN.github.io/ceny-agd/`**

### 4. Token (klucz, który pozwala aplikacji uruchamiać wyszukiwanie)
1. Otwórz https://github.com/settings/personal-access-tokens/new
2. **Token name:** `ceny-agd`. **Expiration:** np. 1 rok.
3. **Repository access → Only select repositories →** wybierz `ceny-agd`.
4. **Permissions → Repository permissions:**
   - **Actions:** Read and write
   - **Contents:** Read and write
5. Kliknij **Generate token** i skopiuj go (zaczyna się od `github_pat_`).

### 5. Telefon i komputer
1. Otwórz `https://TWÓJ-LOGIN.github.io/ceny-agd/`. Aplikacja sama przejdzie do **Ustawień**.
2. Login i repozytorium uzupełnią się same. Wklej token i kliknij **Zapisz i sprawdź**. Powinno się pojawić „✅ Połączono”.
3. Na telefonie dodaj aplikację do ekranu głównego:
   - **Android / Chrome:** menu ⋮ → „Dodaj do ekranu głównego”
   - **iPhone / Safari:** Udostępnij → „Do ekranu początkowego”
4. Na komputerze zrób to samo w przeglądarce. Token wpisujesz **raz na każdym urządzeniu**.

> Tokenu nie wysyłaj nikomu i nie wklejaj do czatu. Zostaje tylko w przeglądarce Twojego urządzenia.
> Jeśli wycieknie, usuń go na https://github.com/settings/personal-access-tokens i utwórz nowy.

### 6. (Opcjonalnie) Powiadomienia o spadku ceny na telefon
1. Zainstaluj darmową aplikację **ntfy** (Google Play / App Store).
2. W ntfy wybierz „Subskrybuj temat” i wymyśl trudną do zgadnięcia nazwę, np. `ceny-agd-k7x2m9q`.
3. W repozytorium otwórz **Settings → Secrets and variables → Actions → New repository secret**.
   Nazwa: `NTFY_TOPIC`, wartość: ta sama nazwa tematu.
4. Obserwowane produkty są sprawdzane 3 razy dziennie. Powiadomienie przychodzi, gdy cena spadnie albo zejdzie poniżej ustawionego progu.

### Dostęp dla innych osób (link)
W **Ustawieniach** kliknij **„Kopiuj link z dostępem”** i wyślij go zaufanej osobie. Po otwarciu linku aplikacja od razu działa, bez wpisywania tokenu.
- Link zawiera Twój token, więc kto go ma, ten może korzystać z aplikacji i uruchamiać wyszukiwania na Twoim koncie GitHub.
- Token jest w części adresu po `#`, której przeglądarka nie wysyła do serwera. Po otwarciu znika z paska adresu.
- Żeby odebrać dostęp, usuń token na https://github.com/settings/personal-access-tokens i utwórz nowy. Wszystkie stare linki przestaną działać. Sobie wpisz nowy token w Ustawieniach.

---

## Wariant prywatny (wyszukiwania i ceny niewidoczne dla innych)

Na darmowym koncie GitHub strona (GitHub Pages) działa tylko z **publicznego** repozytorium. Nawet na płatnym planie Pro sama strona pozostaje publiczna, a ukrycie jej wymaga GitHub Enterprise.
Dlatego robi się to tak:

| Repozytorium | Widoczność | Co w nim jest |
|---|---|---|
| `ceny-agd` | **Private** | wyszukiwanie (Actions), historia cen, obserwowane, wyniki |
| `ceny-agd-strona` | Public | tylko strona aplikacji: kod HTML/JS, **bez żadnych danych** |

Kto otworzy stronę bez linku z dostępem, zobaczy tylko Ustawienia z prośbą o token. Bez tokenu nic nie wyszuka i nic nie zobaczy.

**Kroki:**
1. Utwórz **`ceny-agd` jako Private** i wgraj do niego całą zawartość zip (jak w kroku 2).
2. Utwórz **`ceny-agd-strona` jako Public** i wgraj do niego **ten sam** zip.
3. W `ceny-agd-strona`: **Settings → Pages → Source: GitHub Actions**, potem **Actions → Strona → Run workflow**.
4. Token (krok 4) utwórz z dostępem **tylko do `ceny-agd`** (prywatnego).
5. Otwórz `https://TWÓJ-LOGIN.github.io/ceny-agd-strona/`. W Ustawieniach w polu **Repozytorium** wpisz `ceny-agd`, wklej token i kliknij **Zapisz i sprawdź**.
6. Opcjonalnie, żeby link w powiadomieniu otwierał aplikację: w `ceny-agd` wejdź w **Settings → Secrets and variables → Actions → Variables → New repository variable**. Nazwa `APP_URL`, wartość `https://TWÓJ-LOGIN.github.io/ceny-agd-strona/`.

**Limit:** w prywatnym repozytorium GitHub Free daje **2000 minut Actions miesięcznie** (w publicznym bez limitu).
- Wyszukiwanie modelu zajmuje ok. 1–3 min, a szukanie po opisie lub koszyk 2–5 min.
- Obserwowane 3× dziennie zużywają ok. 3–10 min dziennie, zależnie od liczby produktów.
- Normalne domowe używanie mieści się w limicie z zapasem. Zużycie widać w **Settings → Billing → Usage**.
- Bez podpiętej karty płatniczej po wyczerpaniu limitu wyszukiwanie po prostu przestaje działać do 1. dnia następnego miesiąca. Jeśli masz kartę na GitHubie, sprawdź w **Settings → Billing → Budgets**, czy budżet na Actions wynosi 0 zł.

---

## Sklepy: co działa i jak

| Sklep | Jak |
|---|---|
| RTV Euro AGD, Media Markt, Neonet, OleOle!, x-kom, Komputronik, Morele | bezpośrednio: cena, promocje, dostępność w salonie |
| **Ceneo** | lista ofert wielu sklepów naraz (Allegro, empik, electro.pl, …), a najtańsze są **sprawdzane w samym sklepie** (opis niżej) |
| **Allegro** | Allegro blokuje automaty (CAPTCHA), a jego API wyszukiwania jest tylko dla zweryfikowanych firm. Oferty z Allegro przychodzą **przez Ceneo**, a przycisk otwiera wyniki Allegro posortowane od najtańszych. |
| Media Expert | sklep ma ochronę Cloudflare i z maszyn w chmurze bywa blokowany. Wtedy widać „zablokowane”, a jego oferty często są w Ceneo. |

„beta” przy sklepie oznacza, że adres wyszukiwarki nie był sprawdzony na żywo. Poprawia się go w `src/stores.js`.

### Ceneo nie jest brane na słowo

Ceneo pokazuje ceny z plików, które przysyłają mu sklepy. Bywają nieaktualne, dotyczą innego wariantu albo obowiązują tylko po wejściu z Ceneo. Dlatego aplikacja dla **3 najtańszych ofert** z Ceneo:

1. wchodzi przez link Ceneo do sklepu i odczytuje **prawdziwą cenę** oraz **model** z karty produktu,
2. otwiera tę samą kartę **bez parametrów Ceneo** i sprawdza, czy cena nie jest wyższa przy wejściu bezpośrednim.

| Znak | Znaczenie |
|---|---|
| ✅ | cena w sklepie zgadza się z Ceneo |
| ⚠️ | w sklepie jest inna cena, aplikacja liczy cenę ze sklepu |
| ❌ | pod linkiem jest inny produkt, oferta jest pomijana |
| 🔒 | sklep blokuje sprawdzenie (np. Allegro), sprawdź sam |
| „taniej tylko z linku Ceneo” | kupuj przez ten link, inaczej zapłacisz więcej |
| „sklep: 4,2/5, 15 opinii” | słaba ocena albo mało opinii o sklepie na Ceneo |

Do „Najtaniej” i do koszyka wchodzą **tylko oferty potwierdzone** w sklepie. Niepotwierdzone (🔒, np. Allegro) można dołączyć w Ustawieniach.
Liczbę sprawdzanych ofert zmienia zmienna `CENEO_VERIFY` (domyślnie 3, więcej = dłużej).

## Szukanie po opisie

Wpisz to, co mówisz w sklepie, np. `płyta indukcyjna`, `lodówka do 200cm`, `płyta indukcyjna pięciopolowa`, `zmywarka 45 cm`, `telewizor 55 cali samsung`, `pralka 8kg do 2000 zł`.

- Aplikacja zamienia opis na kategorię i filtry: wysokość, szerokość, głębokość, liczbę pól, kg, cale, cenę, No Frost, klasę energetyczną i markę. Rozpoznane filtry widać nad wynikami.
- Odczytuje listy produktów ze sklepów: ocenę, liczbę opinii, cenę, plakietki promocji i parametry. Ten sam model z kilku sklepów łączy w jeden wynik, a opinie z różnych sklepów sumuje.
- **Kolejność:** ocena z poprawką na liczbę opinii (średnia bayesowska). 4,9 z 563 opinii > 4,6 ze 120 > 4,3 z 40 > 5,0 z **1** opinii. Mniej niż 10 opinii oznacza znaczek „mało opinii – ocena niepewna”.
- Domyślnie widać tylko sprzęt **na promocji**. Odznacz przełącznik, żeby zobaczyć wszystkie.
- Jeśli parametru nie ma na liście sklepu (np. wysokości), produkt zostaje, ale z dopiskiem „nie udało się sprawdzić: …” i spada niżej.
- „Porównaj ceny modelu” uruchamia zwykłe porównanie dla wybranego modelu.

## Raty, zwroty i pozorne promocje

| Na karcie produktu | Co robi aplikacja |
|---|---|
| „66,57 zł × 30 rat 0%”, „Dwie raty gratis! W ratach spłacisz tylko 1 863,86 zł” | pokazuje, ile zapłacisz na raty, i ile to mniej niż gotówką |
| „Nawet 3 raty gratis” (bez kwoty) | tylko informacja: liczba darmowych rat zależy od produktu |
| raty z RRSO > 0 | pokazuje, o ile raty są droższe od gotówki |
| „Zwrot do 3000 zł”, cashback | wypisuje osobno, **nie odejmuje** od ceny (zwrot przychodzi po zakupie, zwykle po rejestracji). Banery innych marek są pomijane. |
| „Kod na kolejne zakupy do 300 zł”, bon Zalando | wypisuje osobno, **nie odejmuje** od ceny |
| „Przed obniżką” / „Cena bez kodu” wyższa, a najniższa cena z 30 dni ≈ cena teraz | **„Pozorna promocja”**, np. Euro: −502 zł z kodem, a 30 dni temu było 1898 zł, więc realnie 1 zł |
| cena była niższa w historii aplikacji, potem wzrosła przed „promocją” | **„Cena podniesiona przed promocją”** |

**W koszyku:** raty gratis i rabat „X zł za każde 500 zł” **nie łączą się** (tak mówi regulamin Euro). Aplikacja liczy oba warianty i wybiera tańszy. Raty można wyłączyć przełącznikiem, bo wymagają zgody banku.

## Podobne, ale tańsze

Przycisk na ekranie wyników. Aplikacja:
1. bierze parametry Twojego modelu z karty produktu (pojemność, wymiary, klasa energetyczna, hałas, obroty, pola, komplety, cale),
2. otwiera jego kategorię w tym samym sklepie, w Euro i OleOle także listę „od najtańszych”,
3. pokazuje tańsze modele o **tych samych albo lepszych** parametrach. Szerokość musi się zgadzać (±2 cm), żeby sprzęt wszedł w to samo miejsce.

Oznaczenia: = taki sam, ▲ lepszy, ? sklep nie podał na liście (sprawdź na karcie).

## Jak liczone są promocje

- Promocje są odczytywane z **plakietek konkretnego produktu**, np. „67 ZŁ ZA KAŻDE WYDANE 500 ZŁ” w Euro albo „70 za 500” w Media Markt. Rabat dotyczy tylko produktów, które mają tę plakietkę.
- „ZYSKAJ 268 ZŁ RABATU” w Euro to ta sama promocja przeliczona dla jednej sztuki, więc **nie jest liczona drugi raz**.
- Domyślnie w jednym sklepie liczona jest najlepsza jedna promocja. Przełącznik „Łącz promocje” zakłada, że łączą się wszystkie.
- To **szacunek**. Przed zakupem sprawdź regulamin promocji.

---

## Wersja na własnym komputerze (bez GitHuba)

Ta sama aplikacja, ale wyszukiwanie działa na Twoim komputerze. Jest szybsze (kilka sekund) i rzadziej blokowane przez sklepy.

1. Zainstaluj **Node.js LTS** (https://nodejs.org) i kliknij dwa razy `start.bat`.
2. Otworzy się `http://localhost:3000`.
3. Dostęp z telefonu w domowym Wi-Fi: w `start.bat` odkomentuj `HOST=0.0.0.0` i `APP_PASSWORD`.

Na serwerze domowym (NAS, mini-PC) z Dockerem: `cp .env.example .env`, potem `docker compose up -d --build`.

## Dla zaawansowanych

| Plik | Co robi |
|---|---|
| `public/` | aplikacja (PWA), ta sama w obu wersjach; `backend.js` wybiera tryb lokalny albo GitHub |
| `src/` | odczyt sklepów (Playwright), dopasowanie modelu, promocje, koszyk, OCR |
| `gh/run.js` | wyszukiwanie uruchamiane w GitHub Actions; wynik trafia do `results/<id>.json` na gałęzi `data` |
| `gh/watch.js` | sprawdzanie obserwowanych i powiadomienia ntfy |
| `.github/workflows/` | `szukaj.yml` (na żądanie), `obserwowane.yml` (3× dziennie), `strona.yml` (publikacja strony) |
| `server.js` | serwer dla wersji na własnym komputerze |

Dane w repozytorium leżą na gałęzi `data`: `history/` (historia cen), `watch.json`, `watch-status.json` i `results/` (wyniki starsze niż 3 dni są usuwane).

**Testy** (offline, na atrapach sklepów i atrapie API GitHuba):
- `npm test`: 65 testów (dopasowanie, ceny, promocje, raty i zwroty, pozorne promocje, szukanie po opisie, podobne-tańsze, koszyk, Ceneo z weryfikacją, Allegro, salon, zdjęcie)
- `npm run test:github`: 30 testów całej wersji GitHub w widoku telefonu
