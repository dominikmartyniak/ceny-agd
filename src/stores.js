// Definicje sklepów.
// searchUrl  – adres wyszukiwarki sklepu
// productHref – wzorzec linku do karty produktu (odsiewa linki do kategorii, promocji itp.)
// verified   – czy URL wyszukiwarki był sprawdzony na żywo (11.2026)
// enabled    – domyślnie włączony w aplikacji
// promoUrls  – strony, z których zbierane są aktualne promocje (zakładka Promocje)
//
// Dodanie nowego sklepu = dopisanie obiektu do tej listy. Nic więcej nie trzeba.

const enc = encodeURIComponent;

module.exports = [
  {
    id: 'euro',
    name: 'RTV EURO AGD',
    domain: 'euro.com.pl',
    promoUrls: ['https://www.euro.com.pl/cms/promocje.bhtml', 'https://www.euro.com.pl/'],
    searchUrl: q => `https://www.euro.com.pl/search.bhtml?keyword=${enc(q)}`,
    productHref: /euro\.com\.pl\/(?!search|cms|artykuly|sklepy)[a-z0-9-]+\/[a-z0-9-]+\.bhtml/i,
    verified: true,
    enabled: true,
  },
  {
    id: 'mediaexpert',
    name: 'Media Expert',
    domain: 'mediaexpert.pl',
    promoUrls: ['https://www.mediaexpert.pl/'],
    searchUrl: q => `https://www.mediaexpert.pl/search?query%5Bmenu_item%5D=&query%5Bquerystring%5D=${enc(q)}`,
    // karty produktów ME mają głęboką ścieżkę: /kategoria/podkategoria/.../nazwa-produktu
    productHref: /mediaexpert\.pl\/(?!search|promocje|lp\/|poradniki)[^?#]+\/[^?#\/]+-[a-z0-9]+[^?#\/]*$/i,
    verified: true, // URL OK, ale sklep ma Cloudflare – patrz README
    enabled: true,
  },
  {
    id: 'neonet',
    name: 'Neonet',
    domain: 'neonet.pl',
    promoUrls: ['https://www.neonet.pl/promocje', 'https://www.neonet.pl/'],
    searchUrl: q => `https://www.neonet.pl/szukaj?q=${enc(q)}`,
    productHref: /neonet\.pl\/p\/\d+-[^?#]+\.html/i,
    verified: true,
    enabled: true,
  },
  {
    id: 'mediamarkt',
    name: 'Media Markt',
    domain: 'mediamarkt.pl',
    promoUrls: ['https://mediamarkt.pl/'],
    searchUrl: q => `https://mediamarkt.pl/pl/search.html?query=${enc(q)}`,
    productHref: /mediamarkt\.pl\/pl\/product\/[^?#]+\.html/i,
    verified: true,
    enabled: true,
  },
  // ---- sklepy dodatkowe ----
  {
    id: 'oleole',
    name: 'OleOle!',
    domain: 'oleole.pl',
    searchUrl: q => `https://www.oleole.pl/search.bhtml?keyword=${enc(q)}`,
    productHref: /oleole\.pl\/(?!search|cms|artykuly)[a-z0-9-]+\/[a-z0-9-]+\.bhtml/i,
    verified: false, // ten sam silnik co Euro
    enabled: true,
  },
  {
    id: 'xkom',
    name: 'x-kom',
    domain: 'x-kom.pl',
    searchUrl: q => `https://www.x-kom.pl/szukaj?q=${enc(q)}`,
    productHref: /x-kom\.pl\/p\/\d+-[^?#]+\.html/i,
    verified: false, // ta sama grupa co Neonet
    enabled: true,
  },
  {
    id: 'komputronik',
    name: 'Komputronik',
    domain: 'komputronik.pl',
    searchUrl: q => `https://www.komputronik.pl/search/category/1?query=${enc(q)}`,
    productHref: /komputronik\.pl\/product\/\d+\/[^?#]+\.html/i,
    verified: false,
    enabled: true,
  },
  {
    id: 'morele',
    name: 'Morele',
    domain: 'morele.net',
    searchUrl: q => `https://www.morele.net/wyszukiwarka/?q=${enc(q)}`,
    productHref: /morele\.net\/[a-z0-9-]+-\d+\/?$/i,
    verified: false,
    enabled: true,
  },
  {
    id: 'ceneo',
    name: 'Ceneo',
    domain: 'ceneo.pl',
    kind: 'ceneo', // karta produktu Ceneo = lista ofert z wielu sklepów (także Allegro, empik, electro…)
    searchUrl: q => `https://www.ceneo.pl/;szukaj-${enc(q)}`,
    productHref: /ceneo\.pl\/\d{5,}(?:[#?;].*)?$/i,
    verified: true,
    enabled: true,
    aggregator: true,
  },
  {
    id: 'allegro',
    name: 'Allegro',
    domain: 'allegro.pl',
    // Allegro blokuje automaty (CAPTCHA), a API wyszukiwania jest tylko dla zweryfikowanych firm.
    // Dlatego: oferty Allegro z Ceneo (jeśli są) + przycisk do wyników posortowanych od najtańszych.
    linkOnly: true,
    searchUrl: q => `https://allegro.pl/listing?string=${enc(q)}&order=p&stan=nowe`,
    productHref: /allegro\.pl\/(oferta|produkt)\//i,
    verified: true,
    enabled: true,
  },
];
